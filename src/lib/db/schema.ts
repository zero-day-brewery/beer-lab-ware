import Dexie, { type Table } from 'dexie'

import type { BrewSession } from '@/lib/brewing/process/session'
import type { Batch } from '@/lib/brewing/types/batch'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { GearItem } from '@/lib/brewing/types/gear'
import type { Ingredient, Water } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Settings } from '@/lib/brewing/types/settings'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

/** Records the id of a seed-provided row the user deleted, so the idempotent
 *  seeder never resurrects it on the next launch. */
export interface SeedTombstone {
  id: string
}

/**
 * Records a row's deletion for the sync merge (Track B, two-way). Every repo
 * delete path writes one of these IN THE SAME transaction as the delete (see
 * the repos in `db/repos/*.ts`) — `mergeState`/`mergeLedger` (sync/merge.ts)
 * use it to stop a row deleted on one device from resurrecting via another
 * device's stale, pre-delete copy. `table` scopes `id` (the deleted row's OWN
 * id) so two different tables' rows never collide even though every table's
 * ids are drawn from the same UUID pool — same single-field-primary-key
 * convention as every other store here (`id`); `table`/`deletedAt` are plain
 * secondary indexes. A SEPARATE concern from `SeedTombstone` above (which
 * only suppresses the idempotent first-boot seeder) — the two mechanisms are
 * never merged.
 */
export interface RowTombstone {
  id: string
  table: string
  deletedAt: string // ISO
}

/** A single key/value row in the device-local appMeta store (backup record +
 *  the opaque File System Access directory handle). NEVER included in backups. */
export interface AppMetaRow {
  key: string
  value: unknown
}

export class BrewDB extends Dexie {
  recipes!: Table<Recipe, string>
  equipmentProfiles!: Table<EquipmentProfile, string>
  ingredients!: Table<Ingredient, string>
  settings!: Table<Settings, string>
  inventoryItems!: Table<InventoryItem, string>
  gearItems!: Table<GearItem, string>
  seedTombstones!: Table<SeedTombstone, string>
  waterProfiles!: Table<Water, string>
  brewSessions!: Table<BrewSession, string>
  brewTimers!: Table<BrewTimer, string>
  batches!: Table<Batch, string>
  readings!: Table<Reading, string>
  stockTransactions!: Table<StockTransaction, string>
  appMeta!: Table<AppMetaRow, string>
  yeastLots!: Table<YeastLot, string>
  rowTombstones!: Table<RowTombstone, string>

  constructor(name = 'brew-db') {
    super(name)
    this.version(1).stores({
      recipes: 'id, name, type, styleId, updatedAt',
      equipmentProfiles: 'id, name, isDefault',
      ingredients: 'id, name, kind, [kind+name]',
      settings: 'id',
    })
    this.version(2).stores({
      inventoryItems: 'id, ingredientKind, name, status, updatedAt',
      gearItems: 'id, category, name, condition, updatedAt',
    })
    this.version(3).stores({
      seedTombstones: 'id',
    })
    this.version(4).stores({
      waterProfiles: 'id, name',
    })
    // v5: Guided Brew Flow. Note: `brewSessions.status` indexes nothing — BrewSession
    // has `lifecycle`, not `status`; getActive() filters on lifecycle (boolean/missing
    // props are never reliable in a where()). String kept verbatim per contract §4.4.
    this.version(5).stores({
      brewSessions: 'id, recipeId, status, stageId, startedAt, updatedAt',
      brewTimers: 'id, sessionId, stepId, status, fireAt',
      batches: 'id, status, batchNo, recipeId, fermenterBoardId, updatedAt, brewedAt',
    })
    // v6: Per-batch fermentation readings log (gravity/temp/pH over time).
    // Additive — only declares the new store; versions 1–5 stay untouched.
    this.version(6).stores({
      readings: 'id, batchId, at, [batchId+at]',
    })
    // v7: Append-only stock ledger for inventory (Inventory Phase 2a). Additive —
    // only declares the new `stockTransactions` store; the `inventoryItems` store
    // is UNCHANGED (its `amount` stays a cached running balance). The upgrade
    // backfills one `opening` txn per existing item so `amount === Σ deltas`
    // holds from day one (no data loss; existing pantry rows survive intact).
    this.version(7)
      .stores({
        stockTransactions: 'id, inventoryItemId, at, batchId, [inventoryItemId+at]',
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString()
        // Read raw rows (untyped inside a migration). Construct the txns inline —
        // migrations stay self-contained so later app-code edits can't alter this
        // historical backfill. Shape matches StockTransactionSchema (schemaVersion 1).
        const items = await tx.table('inventoryItems').toArray()
        const opening = items.map((item) => ({
          id: crypto.randomUUID(),
          inventoryItemId: item.id,
          kind: item.ingredientKind,
          delta: item.amount,
          unit: item.amountUnit,
          reason: 'opening' as const,
          at: item.updatedAt ?? now,
          schemaVersion: 1 as const,
        }))
        if (opening.length > 0) {
          await tx.table('stockTransactions').bulkAdd(opening)
        }
      })
    // v8: Device-local KV for durability metadata (last-backup record + the
    // opaque FSA directory handle). Additive — new empty store, NO upgrade fn;
    // versions 1–7 untouched. EXCLUDED from backups (device-specific).
    this.version(8).stores({ appMeta: 'key' })
    // v9: Yeast lots — lot-level yeast tracking (strain/form/production-date/
    // viable cells) for FIFO-viable pitch selection. Additive — new empty store,
    // NO upgrade fn; versions 1–8 untouched. INCLUDED in backups (DumpV8).
    // `strain` indexes strain lookup, `productionDate` the FIFO ordering.
    this.version(9).stores({
      yeastLots: 'id, strain, form, productionDate, updatedAt',
    })
    // v10: index parentLotId for lineage parent/child lookups. Additive — reindex
    // only, NO upgrade fn; versions 1–9 untouched. New optional fields (parentLotId,
    // harvestedFromBatchId on lots; yeastLotId/yeastDeducted on batches/sessions) need
    // no store change — Dexie versions indexes, not object shape.
    this.version(10).stores({
      yeastLots: 'id, strain, form, productionDate, parentLotId, updatedAt',
    })
    // v11: deletion tombstones for the two-way sync merge (see RowTombstone
    // above). Additive — new empty store, NO upgrade fn; versions 1–10
    // untouched. INCLUDED in backups (DumpV9). SEPARATE from seedTombstones
    // (v3) — do not merge the two mechanisms.
    this.version(11).stores({
      rowTombstones: 'id, table, deletedAt',
    })
  }

  static async delete(name: string): Promise<void> {
    await Dexie.delete(name)
  }
}

export const db = new BrewDB()
