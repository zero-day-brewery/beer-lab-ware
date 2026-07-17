import { z } from 'zod'
import type { BrewSession } from '@/lib/brewing/process/session'
import {
  BACKUP_META_SCHEMA_VERSION,
  type BackupFileMeta,
  BackupFileMetaSchema,
} from '@/lib/brewing/types/backup-meta'
import type { Batch } from '@/lib/brewing/types/batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import { EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import type { GearItem } from '@/lib/brewing/types/gear'
import { GearItemSchema } from '@/lib/brewing/types/gear'
import type { Ingredient, Water } from '@/lib/brewing/types/ingredient'
import { IngredientAnySchema, WaterSchema } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import { ReadingSchema } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { RecipeSchema } from '@/lib/brewing/types/recipe'
import { BrewSessionSchema } from '@/lib/brewing/types/session'
import type { Settings } from '@/lib/brewing/types/settings'
import { SettingsSchema } from '@/lib/brewing/types/settings'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { StockTransactionSchema } from '@/lib/brewing/types/stock-transaction'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import { BrewTimerSchema } from '@/lib/brewing/types/timer'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { YeastLotSchema } from '@/lib/brewing/types/yeast-lot'
import { type BrewDB, db, type RowTombstone, type SeedTombstone } from '@/lib/db/schema'

export interface DumpV1 {
  version: 1
  exportedAt: string
  tables: {
    recipes: Recipe[]
    equipmentProfiles: EquipmentProfile[]
    ingredients: Ingredient[]
    settings: Settings[]
  }
}

export interface DumpV2 {
  version: 2
  exportedAt: string
  tables: {
    recipes: Recipe[]
    equipmentProfiles: EquipmentProfile[]
    ingredients: Ingredient[]
    settings: Settings[]
    inventoryItems: InventoryItem[]
    gearItems: GearItem[]
  }
}

export interface DumpV3 {
  version: 3
  exportedAt: string
  tables: DumpV2['tables'] & { waterProfiles: Water[] }
}

export interface DumpV4 {
  version: 4
  exportedAt: string
  tables: DumpV3['tables'] & {
    batches: Batch[]
    brewSessions: BrewSession[]
    brewTimers: BrewTimer[]
  }
}

export interface DumpV5 {
  version: 5
  exportedAt: string
  tables: DumpV4['tables'] & { readings: Reading[] }
}

export interface DumpV6 {
  version: 6
  exportedAt: string
  tables: DumpV5['tables'] & { stockTransactions: StockTransaction[] }
}

export const DUMP_VERSION = 9 as const // single source; E2 import-guard imports THIS

// seedTombstones is a trivial device-internal row; validated here (Zod on read)
// so a corrupt/hand-edited backup throws BEFORE any clear() — same guarantee the
// other tables get. No standalone types module needed for a one-field row.
const SeedTombstoneSchema = z.object({ id: z.string() })

export interface DumpV7 {
  version: 7
  exportedAt: string
  meta: BackupFileMeta
  tables: DumpV6['tables'] & { seedTombstones: SeedTombstone[] }
}

export interface DumpV8 {
  version: 8
  exportedAt: string
  meta: BackupFileMeta
  tables: DumpV7['tables'] & { yeastLots: YeastLot[] }
}

// rowTombstones is a trivial device-portable row; validated here (Zod on
// read) so a corrupt/hand-edited backup throws BEFORE any clear() — same
// SeedTombstoneSchema treatment above. No standalone types module needed for
// a three-field row. `deletedAt` is checked to PARSE to a finite timestamp
// (not just "some string") — a corrupt value would otherwise fail open:
// `Date.parse` → `NaN` → every comparison against it is false, so it would
// never suppress a row AND never GC (see sync/merge.ts + sync-client.ts).
// Rejecting it at this parse-on-read/write boundary is stronger than any
// GC-level defense — a corrupt dump is refused entirely, before any clear().
const RowTombstoneSchema = z.object({
  id: z.string(),
  table: z.string(),
  deletedAt: z.string().refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'deletedAt must be a parseable timestamp',
  }),
})

export interface DumpV9 {
  version: 9
  exportedAt: string
  meta: BackupFileMeta
  tables: DumpV8['tables'] & { rowTombstones: RowTombstone[] }
}

export type Dump = DumpV1 | DumpV2 | DumpV3 | DumpV4 | DumpV5 | DumpV6 | DumpV7 | DumpV8 | DumpV9

export function makeBackupService(database: BrewDB) {
  return {
    async dump(): Promise<DumpV9> {
      const [
        recipes,
        equipmentProfiles,
        ingredients,
        settings,
        inventoryItems,
        gearItems,
        waterProfiles,
        batches,
        brewSessions,
        brewTimers,
        readings,
        stockTransactions,
        seedTombstones,
        yeastLots,
        rowTombstones,
      ] = await Promise.all([
        database.recipes.toArray(),
        database.equipmentProfiles.toArray(),
        database.ingredients.toArray(),
        database.settings.toArray(),
        database.inventoryItems.toArray(),
        database.gearItems.toArray(),
        database.waterProfiles.toArray(),
        database.batches.toArray(),
        database.brewSessions.toArray() as Promise<BrewSession[]>,
        database.brewTimers.toArray() as Promise<BrewTimer[]>,
        database.readings.toArray(),
        database.stockTransactions.toArray(),
        database.seedTombstones.toArray(),
        database.yeastLots.toArray(),
        database.rowTombstones.toArray(),
      ])
      const tables = {
        recipes,
        equipmentProfiles,
        ingredients,
        settings,
        inventoryItems,
        gearItems,
        waterProfiles,
        batches,
        brewSessions,
        brewTimers,
        readings,
        stockTransactions,
        seedTombstones,
        yeastLots,
        rowTombstones,
      }
      const rowCounts: Record<string, number> = Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, rows.length] as const),
      )
      const meta = BackupFileMetaSchema.parse({
        dumpVersion: DUMP_VERSION,
        dbVersion: database.verno,
        rowCounts,
        schemaVersion: BACKUP_META_SCHEMA_VERSION,
      })
      return { version: 9, exportedAt: new Date().toISOString(), meta, tables }
    },

    async restore(
      d: Dump,
      opts: {
        /** Timestamp to stamp bumped rows with (see `bumpTimestamps`). Injectable for
         *  deterministic tests; defaults to the wall clock. */
        now?: string
        /**
         * Bump every restored row's own last-write timestamp field to `opts.now` —
         * ONLY for a genuine user-initiated backup IMPORT (the "Import backup" UI
         * flow, `components/settings/data-section.tsx`). Defaults to `false`, which
         * is REQUIRED for the internal sync-merge restore (`sync-client.ts`'s
         * `pullMergeRestore` calls `backup.restore(mergedDump)` with no opts on
         * EVERY sync pass) — bumping there would make every row look newest on
         * every sync, destroying LWW ordering across devices. See the restore()
         * doc comment below for why an IMPORT needs this at all.
         */
        bumpTimestamps?: boolean
      } = {},
    ): Promise<void> {
      // Validate the envelope shape before touching anything.
      if (!d || typeof d !== 'object' || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(d.version)) {
        throw new Error(`Unsupported dump version: ${(d as { version?: number })?.version}`)
      }
      const t = d.tables
      if (!t || typeof t !== 'object') {
        throw new Error('Malformed backup: missing tables')
      }

      // Validate EVERY row with its Zod schema up-front. If anything fails we throw
      // here — before any clear() — so a corrupt/hand-edited backup can never wipe
      // good data or write malformed rows that crash later reads.
      const recipes = (t.recipes ?? []).map((r) => RecipeSchema.parse(r))
      const equipmentProfiles = (t.equipmentProfiles ?? []).map((r) =>
        EquipmentProfileSchema.parse(r),
      )
      const ingredients = (t.ingredients ?? []).map((r) => IngredientAnySchema.parse(r))
      const settings = (t.settings ?? []).map((r) => SettingsSchema.parse(r))
      // Phase-2 tables only exist in v2 dumps. For a v1 dump we MUST leave the existing
      // gear/inventory untouched rather than wipe them to empty (data-loss bug).
      // Phase-2 tables (inventory/gear) exist in v2 AND v3 dumps. A v1 dump must
      // leave them untouched rather than wipe to empty.
      const hasPhase2 =
        d.version === 2 ||
        d.version === 3 ||
        d.version === 4 ||
        d.version === 5 ||
        d.version === 6 ||
        d.version === 7 ||
        d.version === 8 ||
        d.version === 9
      const inventoryItems = hasPhase2
        ? d.tables.inventoryItems.map((r) => InventoryItemSchema.parse(r))
        : null
      const gearItems = hasPhase2 ? d.tables.gearItems.map((r) => GearItemSchema.parse(r)) : null
      // waterProfiles only exist in v3+; older dumps leave the table untouched.
      const hasWater =
        d.version === 3 ||
        d.version === 4 ||
        d.version === 5 ||
        d.version === 6 ||
        d.version === 7 ||
        d.version === 8 ||
        d.version === 9
      const waterProfiles = hasWater
        ? (d as DumpV3).tables.waterProfiles.map((r) => WaterSchema.parse(r))
        : null
      // batches/sessions/timers exist in v4+; older dumps leave them untouched.
      const hasV4 =
        d.version === 4 ||
        d.version === 5 ||
        d.version === 6 ||
        d.version === 7 ||
        d.version === 8 ||
        d.version === 9
      const batches = hasV4 ? (d as DumpV4).tables.batches.map((r) => BatchSchema.parse(r)) : null
      const brewSessions = hasV4
        ? (d as DumpV4).tables.brewSessions.map((r) => BrewSessionSchema.parse(r))
        : null
      const brewTimers = hasV4
        ? (d as DumpV4).tables.brewTimers.map((r) => BrewTimerSchema.parse(r))
        : null
      // readings exist in v5+ dumps; older dumps leave the table untouched.
      const hasV5 =
        d.version === 5 || d.version === 6 || d.version === 7 || d.version === 8 || d.version === 9
      const readings = hasV5
        ? (d as DumpV5).tables.readings.map((r) => ReadingSchema.parse(r))
        : null
      // stockTransactions only exist in v6+ dumps. A `restore()` is a destructive
      // "replace ALL data" op, so the ledger is ALWAYS cleared + rewritten: a v6+
      // dump round-trips its txns; an older (pre-ledger) dump restores an EMPTY
      // ledger rather than leaving stale rows that would reference the now-replaced
      // inventory. Never null → always in writeTables so it always gets cleared.
      const hasV6 = d.version === 6 || d.version === 7 || d.version === 8 || d.version === 9
      const stockTransactions: StockTransaction[] = hasV6
        ? (d as DumpV6).tables.stockTransactions.map((r) => StockTransactionSchema.parse(r))
        : []

      // seedTombstones exist in v7+ dumps. Follows the readings (hasV5) NULL
      // pattern: cleared+rewritten on a v7+ dump, left UNTOUCHED on older dumps.
      const hasV7 = d.version === 7 || d.version === 8 || d.version === 9
      const seedTombstones = hasV7
        ? (d as DumpV7).tables.seedTombstones.map((r) => SeedTombstoneSchema.parse(r))
        : null

      // yeastLots exist in v8+ dumps. Same readings NULL pattern: cleared+
      // rewritten on a v8+ dump, left UNTOUCHED on older dumps (lots are standalone,
      // so an older restore need not wipe them).
      const hasV8 = d.version === 8 || d.version === 9
      const yeastLots = hasV8
        ? (d as DumpV8).tables.yeastLots.map((r) => YeastLotSchema.parse(r))
        : null

      // rowTombstones only exist in v9 dumps. Same NULL pattern: cleared+rewritten
      // (from the dump's own set) on a v9 dump, left UNTOUCHED as a WHOLE SET on
      // older dumps — but see `restoredIds` below: regardless of dump version, a
      // restore ALWAYS prunes the specific tombstones for ids it just (re)created,
      // never leaving a just-restored row suppressed by a tombstone that predates
      // this restore.
      //
      // That LOCAL prune alone is not enough to survive the next SYNC, though — the
      // CANONICAL copy on the sync daemon may still hold its own tombstone for that
      // id (this device pruning its own copy doesn't touch canonical), and the next
      // `mergeTombstones` (sync/merge.ts) would union it right back in. So an
      // IMPORT (`opts.bumpTimestamps`, see above) also bumps every restored row's
      // own last-write timestamp to the moment of the restore: strictly newer than
      // ANY pre-restore tombstone (local or remote), so the existing "supersede"
      // pass in `mergeDumpTables` naturally drops the tombstone once it sees the
      // row survived — the restore wins FLEET-WIDE on the next sync, matching a
      // restore's documented destructive-replace intent, not just locally until
      // the next sync silently undoes it.
      //
      // `equipmentProfiles`/`ingredients`/`brewTimers`/`waterProfiles` carry NO
      // last-write timestamp field at all — a restored row in those tables cannot
      // win this way, and a stale remote tombstone can still re-suppress it on the
      // next sync. `readings`/`stockTransactions` DO carry a timestamp (`at`), but
      // it's domain/historical data (when a gravity reading was taken; when a
      // ledger event happened), not a last-write cursor — bumping it would corrupt
      // that meaning, so it's deliberately left alone too. If a restored
      // inventory item's ledger rows still lose to a stale remote ledger-row
      // tombstone post-restore, `reprojectAmounts`'s zero-surviving-txns branch
      // (sync-client.ts) self-heals it with a compensating `sync-reconcile`
      // transaction that preserves the (now-winning) item's restored `amount`.
      const hasV9 = d.version === 9
      const rowTombstones = hasV9
        ? (d as DumpV9).tables.rowTombstones.map((r) => RowTombstoneSchema.parse(r))
        : null

      // Bump ONLY on a genuine import (see the `bumpTimestamps` doc above) —
      // recipes/inventoryItems/gearItems/batches/brewSessions/yeastLots carry a
      // real `updatedAt` LAST-WRITE cursor (safe to bump); everything else is
      // either timestamp-less or domain/historical data (see above) and is left
      // untouched. Mutates the freshly-parsed (not caller-owned) arrays in place.
      if (opts.bumpTimestamps) {
        const restoredAt = opts.now ?? new Date().toISOString()
        for (const r of recipes) r.updatedAt = restoredAt
        if (inventoryItems) for (const r of inventoryItems) r.updatedAt = restoredAt
        if (gearItems) for (const r of gearItems) r.updatedAt = restoredAt
        if (batches) for (const r of batches) r.updatedAt = restoredAt
        if (brewSessions) for (const r of brewSessions) r.updatedAt = restoredAt
        if (yeastLots) for (const r of yeastLots) r.updatedAt = restoredAt
      }

      const v1Tables = [
        database.recipes,
        database.equipmentProfiles,
        database.ingredients,
        database.settings,
      ]
      const clearAndRewriteTables = [
        ...v1Tables,
        ...(gearItems !== null ? [database.inventoryItems, database.gearItems] : []),
        ...(waterProfiles !== null ? [database.waterProfiles] : []),
        ...(batches !== null ? [database.batches, database.brewSessions, database.brewTimers] : []),
        ...(readings !== null ? [database.readings] : []),
        ...(seedTombstones !== null ? [database.seedTombstones] : []),
        ...(yeastLots !== null ? [database.yeastLots] : []),
        ...(rowTombstones !== null ? [database.rowTombstones] : []),
        // Always cleared/rewritten — a restore replaces all data, so the ledger
        // is reset (to the dump's txns, or empty for a pre-v6 dump).
        database.stockTransactions,
      ]
      // rowTombstones must be inside the transaction's LOCK scope even when this
      // dump predates v9 (no clear+rewrite of the whole store) — the targeted
      // restoredIds prune below always touches it.
      const txScope =
        rowTombstones !== null
          ? clearAndRewriteTables
          : [...clearAndRewriteTables, database.rowTombstones]

      await database.transaction('rw', txScope, async () => {
        await Promise.all(clearAndRewriteTables.map((tbl) => tbl.clear()))
        await Promise.all([
          database.recipes.bulkPut(recipes),
          database.equipmentProfiles.bulkPut(equipmentProfiles),
          database.ingredients.bulkPut(ingredients),
          database.settings.bulkPut(settings),
          ...(gearItems !== null
            ? [
                database.inventoryItems.bulkPut(inventoryItems ?? []),
                database.gearItems.bulkPut(gearItems),
              ]
            : []),
          ...(waterProfiles !== null ? [database.waterProfiles.bulkPut(waterProfiles)] : []),
          ...(batches !== null
            ? [
                database.batches.bulkPut(batches),
                database.brewSessions.bulkPut(brewSessions ?? []),
                database.brewTimers.bulkPut(brewTimers ?? []),
              ]
            : []),
          ...(readings !== null ? [database.readings.bulkPut(readings)] : []),
          ...(seedTombstones !== null ? [database.seedTombstones.bulkPut(seedTombstones)] : []),
          ...(yeastLots !== null ? [database.yeastLots.bulkPut(yeastLots)] : []),
          ...(rowTombstones !== null ? [database.rowTombstones.bulkPut(rowTombstones)] : []),
          database.stockTransactions.bulkPut(stockTransactions),
        ])

        // A restore intentionally REPLACES state — any row it just (re)created
        // must never stay suppressed by a tombstone that predates this restore
        // (else the very next sync merge would delete it again, see
        // sync/merge.ts). Prune those unconditionally, even when this dump
        // predates v9 and carries no rowTombstones table of its own at all.
        const restoredIds = [
          ...recipes,
          ...equipmentProfiles,
          ...ingredients,
          ...(inventoryItems ?? []),
          ...(gearItems ?? []),
          ...(waterProfiles ?? []),
          ...(batches ?? []),
          ...(brewSessions ?? []),
          ...(brewTimers ?? []),
          ...(readings ?? []),
          ...stockTransactions,
          ...(yeastLots ?? []),
        ].map((r) => r.id)
        if (restoredIds.length > 0) {
          await database.rowTombstones.bulkDelete(restoredIds)
        }
      })
    },

    async wipe(): Promise<void> {
      const allTables = [
        database.recipes,
        database.equipmentProfiles,
        database.ingredients,
        database.settings,
        database.inventoryItems,
        database.gearItems,
        database.seedTombstones,
        database.waterProfiles,
        database.batches,
        database.brewSessions,
        database.brewTimers,
        database.readings,
        database.stockTransactions,
        database.yeastLots,
        database.rowTombstones,
      ]
      await database.transaction('rw', allTables, async () => {
        await Promise.all(allTables.map((t) => t.clear()))
      })
    },
  }
}

export const backupService = makeBackupService(db)
