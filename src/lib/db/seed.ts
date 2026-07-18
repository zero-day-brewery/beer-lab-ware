/**
 * Idempotent first-boot seeder — example starter inventory (generic sample data).
 *
 * Inserts the B40pro EquipmentProfile + example GearItems + pantry
 * InventoryItems (consumables) with stable IDs. Re-running is safe:
 * existing rows (matched by id) are left untouched so any user edits via the
 * UI survive subsequent seeds.
 */
import { B40PRO_GEAR, B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { CHILLER_GEAR } from '@/lib/brewing/defaults/chiller-gear'
import { CONICAL_GEAR } from '@/lib/brewing/defaults/conical-gear'
import { HOMEBREWING_GEAR } from '@/lib/brewing/defaults/homebrewing'
import { MARKETPLACE_GEAR } from '@/lib/brewing/defaults/marketplace-gear'
import { MISC_GEAR } from '@/lib/brewing/defaults/misc-gear'
import { PANTRY_INVENTORY } from '@/lib/brewing/defaults/pantry'
import { SUPPLIES_GEAR } from '@/lib/brewing/defaults/supplies-gear'
import { WATER_PROFILES } from '@/lib/brewing/defaults/water-profiles'
import { EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import { type GearItem, GearItemSchema } from '@/lib/brewing/types/gear'
import { WaterSchema } from '@/lib/brewing/types/ingredient'
import { type InventoryItem, InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { buildStockTransaction } from '@/lib/brewing/types/stock-transaction'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { type BrewDB, db } from '@/lib/db/schema'
import { newId } from '@/lib/utils/id'

export interface SeedResult {
  insertedProfile: boolean
  insertedGear: number
  skippedGear: number
  insertedInventory: number
  skippedInventory: number
  insertedWater: number
  skippedWater: number
}

const ALL_GEAR: readonly GearItem[] = [
  ...B40PRO_GEAR,
  ...CONICAL_GEAR,
  ...MARKETPLACE_GEAR,
  ...HOMEBREWING_GEAR,
  ...SUPPLIES_GEAR,
  ...CHILLER_GEAR,
  ...MISC_GEAR,
]

const ALL_INVENTORY: readonly InventoryItem[] = [...PANTRY_INVENTORY]

export async function seedDefaults(database: BrewDB = db): Promise<SeedResult> {
  const result: SeedResult = {
    insertedProfile: false,
    insertedGear: 0,
    skippedGear: 0,
    insertedInventory: 0,
    skippedInventory: 0,
    insertedWater: 0,
    skippedWater: 0,
  }

  // Ids the user has deliberately deleted — never resurrect them.
  const tombstoned = new Set((await database.seedTombstones.toArray()).map((t) => t.id))

  const existingProfile = await database.equipmentProfiles.get(B40PRO_PROFILE.id)
  if (!existingProfile && !tombstoned.has(B40PRO_PROFILE.id)) {
    await database.equipmentProfiles.put(EquipmentProfileSchema.parse(B40PRO_PROFILE))
    result.insertedProfile = true
  }

  for (const item of ALL_GEAR) {
    if (tombstoned.has(item.id)) {
      result.skippedGear += 1
      continue
    }
    const existing = await database.gearItems.get(item.id)
    if (existing) {
      result.skippedGear += 1
      continue
    }
    await database.gearItems.put(GearItemSchema.parse(item))
    result.insertedGear += 1
  }

  // Rider fix (E4 QA finding): a freshly-seeded pantry item used to be written
  // with `inventoryItems.put` alone — no matching stockTransaction — so the
  // ledger invariant `amount === Σ deltas` (doctor C1, assertLedgerInvariant)
  // read Σ deltas = 0 against a nonzero seeded `amount` and flagged EVERY
  // pantry item on a brand-new install. Route the write through the SAME
  // atomic item+opening-txn path the v7 migration backfill and the Brewfather
  // importer use (`stockTransactionsRepo.saveItemWithTxn` — one Dexie
  // transaction, item + its opening ledger row land together or not at all),
  // so a fresh install is doctor-clean from the very first launch. Existing
  // installs are NOT migrated here (idempotent re-seed skips rows that
  // already exist) — the doctor's existing C1 auto-fix already repairs those.
  const stockTxRepo = makeStockTransactionsRepo(database)
  for (const item of ALL_INVENTORY) {
    if (tombstoned.has(item.id)) {
      result.skippedInventory += 1
      continue
    }
    const existing = await database.inventoryItems.get(item.id)
    if (existing) {
      result.skippedInventory += 1
      continue
    }
    const validated = InventoryItemSchema.parse(item)
    const opening = buildStockTransaction({
      id: newId(),
      item: validated,
      delta: validated.amount,
      reason: 'opening',
      at: validated.updatedAt,
    })
    await stockTxRepo.saveItemWithTxn(validated, opening)
    result.insertedInventory += 1
  }

  for (const profile of WATER_PROFILES) {
    if (tombstoned.has(profile.id)) {
      result.skippedWater += 1
      continue
    }
    const existing = await database.waterProfiles.get(profile.id)
    if (existing) {
      result.skippedWater += 1
      continue
    }
    await database.waterProfiles.put(WaterSchema.parse(profile))
    result.insertedWater += 1
  }

  return result
}
