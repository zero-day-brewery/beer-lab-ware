import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import { makeEquipmentRepo } from '@/lib/db/repos/equipment'
import { BrewDB } from '@/lib/db/schema'

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
  isDefault: true,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 1,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.2,
  evaporationRate_LperHr: 3,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.04,
  mashEfficiency_pct: 80,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1,
  calibrationNotes_md: '',
  schemaVersion: 1,
}

describe('equipmentRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeEquipmentRepo>

  beforeEach(async () => {
    db = new BrewDB('test-equipment')
    await db.open()
    repo = makeEquipmentRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-equipment')
  })

  it('list() returns empty when nothing saved', async () => {
    expect(await repo.list()).toEqual([])
  })

  it('save() then get() returns the saved profile', async () => {
    await repo.save(b40)
    const fetched = await repo.get(b40.id)
    expect(fetched?.name).toBe('B40 Pro')
  })

  it('list() returns saved profiles', async () => {
    await repo.save(b40)
    const profiles = await repo.list()
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('B40 Pro')
  })

  it('getDefault() returns the profile flagged as default', async () => {
    await repo.save(b40)
    await repo.save({
      ...b40,
      id: '550e8400-e29b-41d4-a716-446655440011',
      name: 'Travel rig',
      isDefault: false,
    })
    const def = await repo.getDefault()
    expect(def?.name).toBe('B40 Pro')
  })

  it('delete() removes the profile', async () => {
    await repo.save(b40)
    await repo.delete(b40.id)
    expect(await repo.get(b40.id)).toBeNull()
  })

  it('save() rejects invalid profile via Zod', async () => {
    await expect(repo.save({ ...b40, kettleVolume_L: -1 } as never)).rejects.toThrow()
  })

  it('saving a new default unsets isDefault on every other profile', async () => {
    await repo.save(b40) // default
    await repo.save({
      ...b40,
      id: '550e8400-e29b-41d4-a716-446655440011',
      name: 'Travel rig',
      isDefault: true, // new default — should demote b40
    })
    const all = await repo.list()
    const defaults = all.filter((p) => p.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].name).toBe('Travel rig')
    expect((await repo.getDefault())?.name).toBe('Travel rig')
  })
})
