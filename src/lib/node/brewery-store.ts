/**
 * Terminal/MCP Stage A — the file-backed brewery STORE (pure Node, no browser).
 *
 * This module loads + persists the app's EXPORTED brewery JSON (the same envelope
 * the in-app "Export backup (JSON)" button produces — a `DumpV10` from
 * `src/lib/db/backup.ts`) using only Node `fs` + the existing Zod schemas. It is
 * the file substrate under which the Node `ToolDeps` / `ActionWriteDeps` run, so
 * the browser app's tool registry + `applyAction` can execute OUTSIDE the browser.
 * It is ALSO the canonical store the Track B sync daemon wraps (GET/PUT /state).
 *
 * Design contract (mirrors `backup.ts`):
 *   - Envelope: `{ version: 1..10, exportedAt, meta?, tables: {...} }`. We READ any
 *     v1..v10 dump (older dumps simply lack the newer tables → empty collections)
 *     and we always WRITE the current v10 envelope (+ a regenerated `meta` sidecar)
 *     via `saveBrewery` — the ONE exception is the sync daemon's `POST /readings`
 *     (`sync-server.ts`), which deliberately bypasses `saveBrewery` for a SURGICAL
 *     raw-JSON write that never bumps a stored file's version (see that module's
 *     header for why).
 *   - Zod-validate EVERY row on load AND on save (CLAUDE.md "parse on read AND write").
 *   - Atomic writes: serialize → write a temp file in the target's dir → `rename`
 *     over the target. A failed/partial write can never corrupt the existing file.
 *
 * NODE-ONLY: no DOM/window/IndexedDB/Dexie. Pages never import `src/lib/node/*`,
 * so this stays out of the Next browser bundle.
 */

import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import {
  BACKUP_META_SCHEMA_VERSION,
  type BackupFileMeta,
  BackupFileMetaSchema,
} from '@/lib/brewing/types/backup-meta'
import type { Batch } from '@/lib/brewing/types/batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import type { DeviceLink } from '@/lib/brewing/types/device-link'
import { DeviceLinkSchema } from '@/lib/brewing/types/device-link'
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
import { type BrewSessionParsed, BrewSessionSchema } from '@/lib/brewing/types/session'
import type { Settings } from '@/lib/brewing/types/settings'
import { SettingsSchema } from '@/lib/brewing/types/settings'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { StockTransactionSchema } from '@/lib/brewing/types/stock-transaction'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import { BrewTimerSchema } from '@/lib/brewing/types/timer'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { YeastLotSchema } from '@/lib/brewing/types/yeast-lot'

/**
 * Device-internal seed-suppression row (mirrors the local schema in backup.ts —
 * a one-field row, no standalone types module needed).
 */
interface SeedTombstone {
  id: string
}
const SeedTombstoneSchema = z.object({ id: z.string() })

/**
 * Deletion tombstone for the sync merge (mirrors `RowTombstone` in
 * db/schema.ts / backup.ts — a three-field row, no standalone types module
 * needed here either).
 */
interface RowTombstone {
  id: string
  table: string
  deletedAt: string
}
// `deletedAt` is checked to PARSE to a finite timestamp — a corrupt value
// would otherwise fail open (`Date.parse` → `NaN` → every comparison against
// it is false, so it would never suppress a row and never GC — see
// sync/merge.ts + sync-client.ts). Same hardening as backup.ts's schema.
const RowTombstoneSchema = z.object({
  id: z.string(),
  table: z.string(),
  deletedAt: z.string().refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'deletedAt must be a parseable timestamp',
  }),
})

/** The current export envelope version we write. Matches `DumpV10` in backup.ts. */
export const CURRENT_DUMP_VERSION = 10 as const

/** The in-memory brewery — one array per exported table, all Zod-validated. */
export interface BreweryCollections {
  recipes: Recipe[]
  equipmentProfiles: EquipmentProfile[]
  ingredients: Ingredient[]
  settings: Settings[]
  inventoryItems: InventoryItem[]
  gearItems: GearItem[]
  waterProfiles: Water[]
  batches: Batch[]
  brewSessions: BrewSessionParsed[]
  brewTimers: BrewTimer[]
  readings: Reading[]
  stockTransactions: StockTransaction[]
  seedTombstones: SeedTombstone[]
  yeastLots: YeastLot[]
  rowTombstones: RowTombstone[]
  deviceLinks: DeviceLink[]
}

/** The on-disk file shape we WRITE (a v10 dump — same envelope as the app). */
export interface BreweryFile {
  version: typeof CURRENT_DUMP_VERSION
  exportedAt: string
  meta: BackupFileMeta
  tables: BreweryCollections
}

/** Envelope versions this store can read. Also reported by `GET /health`. */
export const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/** A fresh, empty set of collections (all tables present, all empty). */
export function emptyCollections(): BreweryCollections {
  return {
    recipes: [],
    equipmentProfiles: [],
    ingredients: [],
    settings: [],
    inventoryItems: [],
    gearItems: [],
    waterProfiles: [],
    batches: [],
    brewSessions: [],
    brewTimers: [],
    readings: [],
    stockTransactions: [],
    seedTombstones: [],
    yeastLots: [],
    rowTombstones: [],
    deviceLinks: [],
  }
}

type RawTables = Record<string, unknown[] | undefined>

/** `xs ?? []` mapped through a Zod parser — validates every row or throws. */
function parseAll<T>(rows: unknown[] | undefined, parse: (r: unknown) => T): T[] {
  return (rows ?? []).map((r) => parse(r))
}

/**
 * Validate a raw (possibly hand-edited) set of tables into typed collections.
 * Zod-parses EVERY row up-front, so a corrupt row throws HERE — before it can be
 * used by a tool or written back to disk. Older dumps that lack newer tables load
 * with those collections empty (never a crash, never silent data loss).
 */
export function validateCollections(tables: RawTables): BreweryCollections {
  return {
    recipes: parseAll(tables.recipes, (r) => RecipeSchema.parse(r)),
    equipmentProfiles: parseAll(tables.equipmentProfiles, (r) => EquipmentProfileSchema.parse(r)),
    ingredients: parseAll(tables.ingredients, (r) => IngredientAnySchema.parse(r)),
    settings: parseAll(tables.settings, (r) => SettingsSchema.parse(r)),
    inventoryItems: parseAll(tables.inventoryItems, (r) => InventoryItemSchema.parse(r)),
    gearItems: parseAll(tables.gearItems, (r) => GearItemSchema.parse(r)),
    waterProfiles: parseAll(tables.waterProfiles, (r) => WaterSchema.parse(r)),
    batches: parseAll(tables.batches, (r) => BatchSchema.parse(r)),
    brewSessions: parseAll(tables.brewSessions, (r) => BrewSessionSchema.parse(r)),
    brewTimers: parseAll(tables.brewTimers, (r) => BrewTimerSchema.parse(r)),
    readings: parseAll(tables.readings, (r) => ReadingSchema.parse(r)),
    stockTransactions: parseAll(tables.stockTransactions, (r) => StockTransactionSchema.parse(r)),
    seedTombstones: parseAll(tables.seedTombstones, (r) => SeedTombstoneSchema.parse(r)),
    yeastLots: parseAll(tables.yeastLots, (r) => YeastLotSchema.parse(r)),
    rowTombstones: parseAll(tables.rowTombstones, (r) => RowTombstoneSchema.parse(r)),
    deviceLinks: parseAll(tables.deviceLinks, (r) => DeviceLinkSchema.parse(r)),
  }
}

/**
 * Assert the append-only ledger invariant: for every inventory item, its cached
 * `amount` equals the signed sum of that item's `stockTransactions.delta`
 * (`amount === Σ deltas`, see stock-transaction.ts). A float epsilon tolerates
 * IEEE drift. Throws on the first violation — used to reject an untrusted dump
 * (e.g. a buggy device's sync PUT) BEFORE it becomes canonical.
 */
export function assertLedgerInvariant(collections: BreweryCollections): void {
  const sums = new Map<string, number>()
  for (const txn of collections.stockTransactions) {
    sums.set(txn.inventoryItemId, (sums.get(txn.inventoryItemId) ?? 0) + txn.delta)
  }
  const EPSILON = 1e-6
  for (const item of collections.inventoryItems) {
    const summed = sums.get(item.id) ?? 0
    if (Math.abs(item.amount - summed) > EPSILON) {
      throw new Error(
        `Ledger invariant violated for item ${item.id}: amount=${item.amount} but Σdeltas=${summed}`,
      )
    }
  }
}

/**
 * Parse the export envelope: assert the version + tables shape (like
 * `backupService.restore`), then Zod-validate every row. Throws a clear error on
 * a malformed envelope so a bad file is rejected BEFORE any adapter touches it.
 */
export function parseEnvelope(raw: unknown): BreweryCollections {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Malformed brewery export: not a JSON object')
  }
  const env = raw as { version?: unknown; tables?: unknown; meta?: unknown }
  if (typeof env.version !== 'number' || !SUPPORTED_VERSIONS.includes(env.version as 1)) {
    throw new Error(`Unsupported brewery export version: ${String(env.version)}`)
  }
  if (!env.tables || typeof env.tables !== 'object') {
    throw new Error('Malformed brewery export: missing tables')
  }
  // v7+ dumps carry a `meta` sidecar — validate it when present (a malformed meta
  // is a corrupt dump, same treatment as a bad row).
  if (env.version >= 7 && env.meta !== undefined) {
    BackupFileMetaSchema.parse(env.meta)
  }
  return validateCollections(env.tables as RawTables)
}

/** Row counts per table, for the dump `meta` sidecar. */
function rowCountsOf(c: BreweryCollections): Record<string, number> {
  return Object.fromEntries(
    Object.entries(c).map(([name, rows]) => [name, (rows as unknown[]).length] as const),
  )
}

/**
 * ATOMIC JSON write: serialize FIRST (a non-serializable value throws before any
 * fs op), write a uniquely-named temp file IN THE TARGET'S DIRECTORY, then
 * `rename` it over the target (atomic on a single filesystem). If the rename
 * fails the temp is cleaned up and the original file is left untouched — a failed
 * write can never leave the existing file half-written or corrupt.
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2)
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  await fs.writeFile(tmp, json, 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

const BACKUP_SUFFIX = '.bak'

/** `2026-07-16T10:15:00.000Z` → `2026-07-16T101500Z` (filename-safe, second precision). */
function backupTimestamp(d: Date): string {
  return d
    .toISOString()
    .replace(/:/g, '')
    .replace(/\.\d+Z$/, 'Z')
}

/** True when `entryName` is a rotated backup of `filePath` (`<basename>.<...>.bak`). */
function isBackupOf(filePath: string, entryName: string): boolean {
  const base = path.basename(filePath)
  return entryName.startsWith(`${base}.`) && entryName.endsWith(BACKUP_SUFFIX)
}

/**
 * Copy `contents` to `<filePath>.<stamp>.bak`, using `COPYFILE_EXCL` so two
 * generations landing in the same wall-clock second never silently clobber each
 * other — on a name collision a `-N` counter is appended before `.bak`.
 */
async function writeUniqueBackup(filePath: string, stamp: string, contents: Buffer): Promise<void> {
  let n = 0
  for (;;) {
    const suffix = n === 0 ? '' : `-${n}`
    const candidate = `${filePath}.${stamp}${suffix}${BACKUP_SUFFIX}`
    try {
      await fs.writeFile(candidate, contents, { flag: 'wx' })
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        n += 1
        continue
      }
      throw err
    }
  }
}

/** Delete the oldest backups (by mtime) of `filePath` so at most `keep` remain. */
async function pruneGenerations(filePath: string, keep: number): Promise<void> {
  const dir = path.dirname(filePath)
  const names = (await fs.readdir(dir)).filter((n) => isBackupOf(filePath, n))
  if (names.length <= keep) return
  const withMtime = await Promise.all(
    names.map(async (n) => {
      const full = path.join(dir, n)
      const { mtimeMs } = await fs.stat(full)
      return { full, mtimeMs }
    }),
  )
  withMtime.sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first
  const toDelete = withMtime.slice(0, withMtime.length - keep)
  await Promise.all(toDelete.map((f) => fs.rm(f.full, { force: true })))
}

/**
 * Rotate server-side generations of `filePath` BEFORE it gets overwritten: copy
 * the current file to `<filePath>.<ISO-timestamp>.bak`, then prune the oldest
 * backups so at most `keep` remain. A no-op when:
 *   - `keep <= 0` (generations disabled), or
 *   - `filePath` doesn't exist yet (the very first PUT has nothing to back up).
 * Independent of `atomicWriteJson`'s temp+rename — callers await this BEFORE
 * calling `atomicWriteJson` so the pre-overwrite snapshot is durable before the
 * canonical file changes; it never touches the atomic write path itself.
 */
export async function rotateGenerations(
  filePath: string,
  keep: number,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (keep <= 0) return
  let current: Buffer
  try {
    current = await fs.readFile(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  await writeUniqueBackup(filePath, backupTimestamp(now()), current)
  await pruneGenerations(filePath, keep)
}

/**
 * Read + JSON.parse + Zod-validate a brewery export file into in-memory
 * collections. Throws on a missing file, invalid JSON, an unsupported version, or
 * any row that fails its schema.
 */
export async function loadBrewery(filePath: string): Promise<BreweryCollections> {
  const text = await fs.readFile(filePath, 'utf8')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `Malformed brewery export: invalid JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  return parseEnvelope(raw)
}

/**
 * Serialize collections back into the current export envelope and write it atomically.
 * Re-validates every row before writing (parse-on-write), so a save can never
 * persist a malformed row; combined with the temp+rename it never corrupts the
 * existing file on failure.
 */
export async function saveBrewery(
  filePath: string,
  collections: BreweryCollections,
  exportedAt: string = new Date().toISOString(),
): Promise<void> {
  const validated = validateCollections(collections as unknown as RawTables)
  // Synthesize a valid v8 `meta` sidecar. dbVersion is a sentinel here — the node
  // store is file-backed, not a Dexie DB, so it has no live schema verno; the
  // real client meta is preserved verbatim by the sync daemon, not regenerated.
  const meta: BackupFileMeta = BackupFileMetaSchema.parse({
    dumpVersion: CURRENT_DUMP_VERSION,
    dbVersion: CURRENT_DUMP_VERSION,
    rowCounts: rowCountsOf(validated),
    schemaVersion: BACKUP_META_SCHEMA_VERSION,
  })
  const envelope: BreweryFile = {
    version: CURRENT_DUMP_VERSION,
    exportedAt,
    meta,
    tables: validated,
  }
  await atomicWriteJson(filePath, envelope)
}
