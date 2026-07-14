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
import { type BrewDB, db } from '@/lib/db/schema'

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
    await database.inventoryItems.put(InventoryItemSchema.parse(item))
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
