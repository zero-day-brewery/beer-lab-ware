import { z } from 'zod'
import { BatchSchema } from '@/lib/brewing/types/batch'
import { EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import { GearItemSchema } from '@/lib/brewing/types/gear'
import { IngredientAnySchema, WaterSchema } from '@/lib/brewing/types/ingredient'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { ReadingSchema } from '@/lib/brewing/types/reading'
import { RecipeSchema } from '@/lib/brewing/types/recipe'
import { BrewSessionSchema } from '@/lib/brewing/types/session'
import { SettingsSchema } from '@/lib/brewing/types/settings'
import { StockTransactionSchema } from '@/lib/brewing/types/stock-transaction'
import { BrewTimerSchema } from '@/lib/brewing/types/timer'
import { YeastLotSchema } from '@/lib/brewing/types/yeast-lot'
import { type BrewDB, db } from '@/lib/db/schema'
import { tsOf } from '@/lib/sync/merge'

export interface DoctorCheck {
  id: string
  label: string
  ok: boolean
  severity: 'error' | 'warn'
  count: number
  message: string
  sampleIds?: string[]
  canAutoFix?: boolean
}

export interface DoctorReport {
  checks: DoctorCheck[]
  passed: number
  failed: number
}

const TABLE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  recipes: RecipeSchema,
  equipmentProfiles: EquipmentProfileSchema,
  ingredients: IngredientAnySchema,
  settings: SettingsSchema,
  inventoryItems: InventoryItemSchema,
  gearItems: GearItemSchema,
  waterProfiles: WaterSchema,
  batches: BatchSchema,
  brewSessions: BrewSessionSchema,
  brewTimers: BrewTimerSchema,
  readings: ReadingSchema,
  stockTransactions: StockTransactionSchema,
  seedTombstones: z.object({ id: z.string() }),
  yeastLots: YeastLotSchema,
  rowTombstones: z.object({
    id: z.string(),
    table: z.string(),
    // Same "parses to a finite timestamp" hardening as backup.ts/brewery-store.ts —
    // catches a corrupt deletedAt that would otherwise fail open in the sync merge.
    deletedAt: z.string().refine((s) => Number.isFinite(Date.parse(s)), {
      message: 'deletedAt must be a parseable timestamp',
    }),
  }),
}

function check(base: Omit<DoctorCheck, 'ok'>, failingIds: string[]): DoctorCheck {
  return {
    ...base,
    ok: failingIds.length === 0,
    count: failingIds.length,
    sampleIds: failingIds.slice(0, 10),
  }
}

export async function runDataDoctor(
  database: BrewDB = db,
  expectedVerno: number = db.verno,
): Promise<DoctorReport> {
  const [items, txns, readings, batches, timers, sessions, settingsRows, equipment] =
    await Promise.all([
      database.inventoryItems.toArray(),
      database.stockTransactions.toArray(),
      database.readings.toArray(),
      database.batches.toArray(),
      database.brewTimers.toArray(),
      database.brewSessions.toArray(),
      database.settings.toArray(),
      database.equipmentProfiles.toArray(),
    ])

  const checks: DoctorCheck[] = []

  // C1 — ledger invariant amount === Σ deltas (epsilon, never ===)
  const sums = new Map<string, number>()
  for (const t of txns) sums.set(t.inventoryItemId, (sums.get(t.inventoryItemId) ?? 0) + t.delta)
  const c1Fail = items
    .filter((i) => Math.abs((sums.get(i.id) ?? 0) - i.amount) > 1e-6)
    .map((i) => i.id)
  checks.push(
    check(
      {
        id: 'C1',
        label: 'Inventory ledger balances',
        severity: 'error',
        count: 0,
        message: 'Cached inventory amount drifted from the sum of its ledger transactions.',
        canAutoFix: true,
      },
      c1Fail,
    ),
  )

  // C2 — orphan stockTransactions
  const itemIds = new Set(items.map((i) => i.id))
  const c2Fail = txns.filter((t) => !itemIds.has(t.inventoryItemId)).map((t) => t.id)
  checks.push(
    check(
      {
        id: 'C2',
        label: 'No orphan stock transactions',
        severity: 'error',
        count: 0,
        message: 'A stock transaction references a missing inventory item.',
      },
      c2Fail,
    ),
  )

  // C3 — orphan readings.batchId
  const batchIds = new Set(batches.map((b) => b.id))
  const c3Fail = readings.filter((r) => !batchIds.has(r.batchId)).map((r) => r.id)
  checks.push(
    check(
      {
        id: 'C3',
        label: 'No orphan readings',
        severity: 'error',
        count: 0,
        message: 'A fermentation reading references a missing batch.',
      },
      c3Fail,
    ),
  )

  // C4 — orphan brewTimers.sessionId
  const sessionIds = new Set(sessions.map((s) => s.id))
  const c4Fail = timers.filter((t) => !sessionIds.has(t.sessionId)).map((t) => t.id)
  checks.push(
    check(
      {
        id: 'C4',
        label: 'No orphan brew timers',
        severity: 'error',
        count: 0,
        message: 'A brew timer references a missing session.',
      },
      c4Fail,
    ),
  )

  // C5 — dangling settings.defaultEquipmentProfileId
  const equipIds = new Set(equipment.map((e) => e.id))
  const c5Fail = settingsRows
    .filter((s) => !equipIds.has(s.defaultEquipmentProfileId))
    .map((s) => s.id)
  checks.push(
    check(
      {
        id: 'C5',
        label: 'Default equipment profile exists',
        severity: 'error',
        count: 0,
        message: 'Settings point at a deleted default equipment profile.',
      },
      c5Fail,
    ),
  )

  // C6 — schema version matches expected (derived from db.verno, not a literal)
  checks.push({
    id: 'C6',
    label: 'Database schema version',
    ok: database.verno === expectedVerno,
    severity: 'error',
    count: database.verno === expectedVerno ? 0 : 1,
    message: `Open schema version ${database.verno} does not match expected ${expectedVerno}.`,
  })

  // C7 — Zod sweep per table
  let c7Failures = 0
  const c7Sample: string[] = []
  for (const table of database.tables) {
    const schema = TABLE_SCHEMAS[table.name]
    if (!schema) continue // appMeta (opaque device-local KV) is intentionally not swept
    const rows = await table.toArray()
    for (const row of rows) {
      if (!schema.safeParse(row).success) {
        c7Failures++
        const id = (row as { id?: unknown }).id
        if (typeof id === 'string' && c7Sample.length < 10) c7Sample.push(`${table.name}:${id}`)
      }
    }
  }
  checks.push({
    id: 'C7',
    label: 'All rows pass their schema',
    ok: c7Failures === 0,
    severity: 'error',
    count: c7Failures,
    message: 'One or more stored rows fail their Zod schema (would blank a page on read).',
    sampleIds: c7Sample,
  })

  // C8 — tombstone/row coexistence anomaly (read-only diagnosis, no auto-fix).
  // A live row is a merge-safety violation when a tombstone for the SAME
  // (table,id) has a `deletedAt` at-or-after the row's own last-write
  // timestamp — `mergeState`/`mergeLedger` (sync/merge.ts) should have
  // suppressed that row during a sync merge, so its survival indicates a
  // merge bug (or a hand-edited/corrupt import), not legitimate
  // edit-after-delete (which requires row-ts STRICTLY AFTER deletedAt — see
  // sync-client.ts's "supersede" rule, which drops the tombstone once that's
  // true; a row newer than its tombstone but the tombstone not yet GC'd is
  // NOT an anomaly).
  const tombstoneRows = await database.rowTombstones.toArray()
  const tombstonesByTable = new Map<string, Map<string, string>>()
  for (const t of tombstoneRows) {
    let byId = tombstonesByTable.get(t.table)
    if (!byId) {
      byId = new Map()
      tombstonesByTable.set(t.table, byId)
    }
    byId.set(t.id, t.deletedAt)
  }
  const c8Fail: string[] = []
  for (const table of database.tables) {
    const byId = tombstonesByTable.get(table.name)
    if (!byId || !TABLE_SCHEMAS[table.name]) continue
    const rows = await table.toArray()
    for (const row of rows) {
      const id = (row as { id?: unknown }).id
      if (typeof id !== 'string') continue
      const deletedAtIso = byId.get(id)
      if (deletedAtIso === undefined) continue
      if (tsOf(row as Record<string, unknown>) <= Date.parse(deletedAtIso)) {
        c8Fail.push(`${table.name}:${id}`)
      }
    }
  }
  checks.push(
    check(
      {
        id: 'C8',
        label: 'No tombstone/row coexistence anomalies',
        severity: 'warn',
        count: 0,
        message: `A row coexists with a tombstone that should have suppressed it on the next sync merge (merge bug or hand-edited import). ${tombstoneRows.length} tombstone(s) total in the database.`,
      },
      c8Fail,
    ),
  )

  const failed = checks.filter((c) => !c.ok).length
  return { checks, passed: checks.length - failed, failed }
}

/** Recompute InventoryItem.amount = Σ deltas. Appends NO stockTransaction (the
 *  ledger is authoritative; a phantom manual-adjust txn would corrupt the
 *  append-only audit trail). One rw txn. Returns the number of items corrected. */
export async function autoFixLedger(database: BrewDB = db): Promise<number> {
  return database.transaction(
    'rw',
    [database.inventoryItems, database.stockTransactions],
    async () => {
      const [items, txns] = await Promise.all([
        database.inventoryItems.toArray(),
        database.stockTransactions.toArray(),
      ])
      const sums = new Map<string, number>()
      for (const t of txns)
        sums.set(t.inventoryItemId, (sums.get(t.inventoryItemId) ?? 0) + t.delta)
      let fixed = 0
      for (const item of items) {
        const want = sums.get(item.id) ?? 0
        if (Math.abs(want - item.amount) > 1e-6) {
          // A negative net (surviving brew-deduct whose `opening` row was dropped)
          // would violate InventoryItemSchema.amount.nonnegative() — persisting it
          // turns a recoverable C1 drift into a C7 (unloadable) row. Skip it: leave
          // the amount untouched so C1 keeps reporting it as un-auto-fixable.
          if (want < 0) continue
          await database.inventoryItems.update(item.id, { amount: want })
          fixed++
        }
      }
      return fixed
    },
  )
}
