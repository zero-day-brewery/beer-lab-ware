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
import { type BrewDB, db, type SeedTombstone } from '@/lib/db/schema'

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

export const DUMP_VERSION = 8 as const // single source; E2 import-guard imports THIS

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

export type Dump = DumpV1 | DumpV2 | DumpV3 | DumpV4 | DumpV5 | DumpV6 | DumpV7 | DumpV8

export function makeBackupService(database: BrewDB) {
  return {
    async dump(): Promise<DumpV8> {
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
      return { version: 8, exportedAt: new Date().toISOString(), meta, tables }
    },

    async restore(d: Dump): Promise<void> {
      // Validate the envelope shape before touching anything.
      if (!d || typeof d !== 'object' || ![1, 2, 3, 4, 5, 6, 7, 8].includes(d.version)) {
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
        d.version === 8
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
        d.version === 8
      const waterProfiles = hasWater
        ? (d as DumpV3).tables.waterProfiles.map((r) => WaterSchema.parse(r))
        : null
      // batches/sessions/timers exist in v4+; older dumps leave them untouched.
      const hasV4 =
        d.version === 4 || d.version === 5 || d.version === 6 || d.version === 7 || d.version === 8
      const batches = hasV4 ? (d as DumpV4).tables.batches.map((r) => BatchSchema.parse(r)) : null
      const brewSessions = hasV4
        ? (d as DumpV4).tables.brewSessions.map((r) => BrewSessionSchema.parse(r))
        : null
      const brewTimers = hasV4
        ? (d as DumpV4).tables.brewTimers.map((r) => BrewTimerSchema.parse(r))
        : null
      // readings exist in v5 AND v6 dumps; older dumps leave the table untouched.
      const hasV5 = d.version === 5 || d.version === 6 || d.version === 7 || d.version === 8
      const readings = hasV5
        ? (d as DumpV5).tables.readings.map((r) => ReadingSchema.parse(r))
        : null
      // stockTransactions only exist in v6 dumps. A `restore()` is a destructive
      // "replace ALL data" op, so the ledger is ALWAYS cleared + rewritten: a v6
      // dump round-trips its txns; an older (pre-ledger) dump restores an EMPTY
      // ledger rather than leaving stale rows that would reference the now-replaced
      // inventory. Never null → always in writeTables so it always gets cleared.
      const hasV6 = d.version === 6 || d.version === 7 || d.version === 8
      const stockTransactions: StockTransaction[] = hasV6
        ? (d as DumpV6).tables.stockTransactions.map((r) => StockTransactionSchema.parse(r))
        : []

      // seedTombstones exist in v7 AND v8 dumps. Follows the readings (hasV5) NULL
      // pattern: cleared+rewritten on a v7/v8 dump, left UNTOUCHED on older dumps.
      const hasV7 = d.version === 7 || d.version === 8
      const seedTombstones = hasV7
        ? (d as DumpV7).tables.seedTombstones.map((r) => SeedTombstoneSchema.parse(r))
        : null

      // yeastLots only exist in v8 dumps. Same readings NULL pattern: cleared+
      // rewritten on a v8 dump, left UNTOUCHED on older dumps (lots are standalone,
      // so an older restore need not wipe them).
      const hasV8 = d.version === 8
      const yeastLots = hasV8
        ? (d as DumpV8).tables.yeastLots.map((r) => YeastLotSchema.parse(r))
        : null

      const v1Tables = [
        database.recipes,
        database.equipmentProfiles,
        database.ingredients,
        database.settings,
      ]
      const writeTables = [
        ...v1Tables,
        ...(gearItems !== null ? [database.inventoryItems, database.gearItems] : []),
        ...(waterProfiles !== null ? [database.waterProfiles] : []),
        ...(batches !== null ? [database.batches, database.brewSessions, database.brewTimers] : []),
        ...(readings !== null ? [database.readings] : []),
        ...(seedTombstones !== null ? [database.seedTombstones] : []),
        ...(yeastLots !== null ? [database.yeastLots] : []),
        // Always cleared/rewritten — a restore replaces all data, so the ledger
        // is reset (to the dump's txns, or empty for a pre-v6 dump).
        database.stockTransactions,
      ]

      await database.transaction('rw', writeTables, async () => {
        await Promise.all(writeTables.map((tbl) => tbl.clear()))
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
          database.stockTransactions.bulkPut(stockTransactions),
        ])
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
      ]
      await database.transaction('rw', allTables, async () => {
        await Promise.all(allTables.map((t) => t.clear()))
      })
    },
  }
}

export const backupService = makeBackupService(db)
