import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Water } from '@/lib/brewing/types/ingredient'
import { makeWaterRepo } from '@/lib/db/repos/water'
import { BrewDB } from '@/lib/db/schema'

const burton: Water = {
  id: '7a7e0001-0000-4000-8000-0000000000aa',
  kind: 'water',
  name: 'Burton-on-Trent',
  Ca_ppm: 275,
  Mg_ppm: 40,
  Na_ppm: 25,
  SO4_ppm: 610,
  Cl_ppm: 35,
  HCO3_ppm: 270,
}

const dublin: Water = {
  id: '7a7e0001-0000-4000-8000-0000000000bb',
  kind: 'water',
  name: 'Dublin',
  Ca_ppm: 118,
  Mg_ppm: 4,
  Na_ppm: 12,
  SO4_ppm: 55,
  Cl_ppm: 19,
  HCO3_ppm: 280,
}

describe('waterRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeWaterRepo>

  beforeEach(async () => {
    db = new BrewDB('test-water')
    await db.open()
    repo = makeWaterRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-water')
  })

  it('list() returns empty when nothing saved', async () => {
    expect(await repo.list()).toEqual([])
  })

  it('save() then get() round-trips a Zod-valid profile', async () => {
    const saved = await repo.save(burton)
    expect(saved).toEqual(burton)
    const fetched = await repo.get(burton.id)
    expect(fetched?.name).toBe('Burton-on-Trent')
    expect(fetched?.SO4_ppm).toBe(610)
  })

  it('list() returns saved profiles sorted by name', async () => {
    await repo.save(burton)
    await repo.save(dublin)
    const profiles = await repo.list()
    expect(profiles.map((p) => p.name)).toEqual(['Burton-on-Trent', 'Dublin'])
  })

  it('delete() removes the profile', async () => {
    await repo.save(burton)
    await repo.delete(burton.id)
    expect(await repo.get(burton.id)).toBeNull()
  })

  it('save() rejects a negative ion via Zod', async () => {
    await expect(repo.save({ ...burton, Cl_ppm: -1 } as never)).rejects.toThrow()
  })

  it('save() rejects an empty name via Zod', async () => {
    await expect(repo.save({ ...burton, name: '' } as never)).rejects.toThrow()
  })
})
