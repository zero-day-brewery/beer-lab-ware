import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B40PRO_GEAR, B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { CHILLER_GEAR } from '@/lib/brewing/defaults/chiller-gear'
import { CONICAL_GEAR } from '@/lib/brewing/defaults/conical-gear'
import { HOMEBREWING_GEAR } from '@/lib/brewing/defaults/homebrewing'
import { MARKETPLACE_GEAR } from '@/lib/brewing/defaults/marketplace-gear'
import { MISC_GEAR } from '@/lib/brewing/defaults/misc-gear'
import { PANTRY_INVENTORY } from '@/lib/brewing/defaults/pantry'
import { SUPPLIES_GEAR } from '@/lib/brewing/defaults/supplies-gear'
import { EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import { GearItemSchema } from '@/lib/brewing/types/gear'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { BrewDB } from '@/lib/db/schema'
import { seedDefaults } from '@/lib/db/seed'

const ALL_GEAR = [
  ...B40PRO_GEAR,
  ...CONICAL_GEAR,
  ...MARKETPLACE_GEAR,
  ...HOMEBREWING_GEAR,
  ...SUPPLIES_GEAR,
  ...CHILLER_GEAR,
  ...MISC_GEAR,
]

const ALL_INVENTORY = [...PANTRY_INVENTORY]

describe('default profile and gear shape', () => {
  it('the B40pro profile is a valid EquipmentProfile', () => {
    expect(() => EquipmentProfileSchema.parse(B40PRO_PROFILE)).not.toThrow()
  })

  it('every Brewtools gear item is a valid GearItem', () => {
    for (const item of B40PRO_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every conical gear item is a valid GearItem', () => {
    for (const item of CONICAL_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every marketplace gear item is a valid GearItem', () => {
    for (const item of MARKETPLACE_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every homebrewing gear item is a valid GearItem', () => {
    for (const item of HOMEBREWING_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every supplies gear item is a valid GearItem', () => {
    for (const item of SUPPLIES_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every chiller gear item is a valid GearItem', () => {
    for (const item of CHILLER_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every misc gear item is a valid GearItem', () => {
    for (const item of MISC_GEAR) {
      expect(() => GearItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every pantry inventory item is a valid InventoryItem', () => {
    for (const item of PANTRY_INVENTORY) {
      expect(() => InventoryItemSchema.parse(item)).not.toThrow()
    }
  })

  it('every id is unique across all gear and inventory', () => {
    const ids = [...ALL_GEAR, ...ALL_INVENTORY].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('the profile is marked default', () => {
    expect(B40PRO_PROFILE.isDefault).toBe(true)
  })
})

describe('seedDefaults', () => {
  let db: BrewDB

  beforeEach(async () => {
    db = new BrewDB('test-seed')
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-seed')
  })

  it('inserts profile + all gear on an empty database', async () => {
    const result = await seedDefaults(db)
    expect(result.insertedProfile).toBe(true)
    expect(result.insertedGear).toBe(ALL_GEAR.length)
    expect(result.skippedGear).toBe(0)
    expect(result.insertedInventory).toBe(ALL_INVENTORY.length)
    expect(result.skippedInventory).toBe(0)

    const profile = await db.equipmentProfiles.get(B40PRO_PROFILE.id)
    expect(profile?.name).toBe('B40pro (US110V)')

    const gear = await db.gearItems.toArray()
    expect(gear).toHaveLength(ALL_GEAR.length)

    const inventory = await db.inventoryItems.toArray()
    expect(inventory).toHaveLength(ALL_INVENTORY.length)
  })

  it('is idempotent — re-running inserts nothing and preserves user edits', async () => {
    await seedDefaults(db)

    // Simulate user renaming the profile and editing items via UI
    await db.equipmentProfiles.put({
      ...B40PRO_PROFILE,
      name: 'My Renamed B40',
      brewhouseEfficiency_pct: 80,
    })
    const primaryGear = B40PRO_GEAR.find((g) => g.name.startsWith('All-in-One Brewing System'))
    if (!primaryGear) throw new Error('All-in-One Brewing System missing from fixture')
    await db.gearItems.put({ ...primaryGear, location: 'Storage room' })

    const fermenter = CONICAL_GEAR.find((g) => g.name.startsWith('Jacketed Conical Fermenter'))
    if (!fermenter) throw new Error('Jacketed Conical Fermenter missing from conical fixture')
    await db.gearItems.put({ ...fermenter, condition: 'worn' })

    const second = await seedDefaults(db)
    expect(second.insertedProfile).toBe(false)
    expect(second.insertedGear).toBe(0)
    expect(second.skippedGear).toBe(ALL_GEAR.length)
    expect(second.insertedInventory).toBe(0)
    expect(second.skippedInventory).toBe(ALL_INVENTORY.length)

    const profile = await db.equipmentProfiles.get(B40PRO_PROFILE.id)
    expect(profile?.name).toBe('My Renamed B40')
    expect(profile?.brewhouseEfficiency_pct).toBe(80)

    const editedGear = await db.gearItems.get(primaryGear.id)
    expect(editedGear?.location).toBe('Storage room')

    const editedFermenter = await db.gearItems.get(fermenter.id)
    expect(editedFermenter?.condition).toBe('worn')
  })

  it('does not resurrect a seeded item the user deleted (tombstone)', async () => {
    await seedDefaults(db)
    const victim = B40PRO_GEAR[0]
    // Simulate a UI delete: remove the row + tombstone it (as the repo does).
    await db.gearItems.delete(victim.id)
    await db.seedTombstones.put({ id: victim.id })

    const second = await seedDefaults(db)
    expect(second.insertedGear).toBe(0)
    expect(await db.gearItems.get(victim.id)).toBeUndefined()
    expect(await db.gearItems.count()).toBe(ALL_GEAR.length - 1)
  })
})
