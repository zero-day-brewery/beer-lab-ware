import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GearItem } from '@/lib/brewing/types/gear'
import { makeGearRepo } from '@/lib/db/repos/gear'
import { BrewDB } from '@/lib/db/schema'

const item: GearItem = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
  category: 'kettle',
  condition: 'good',
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('gearRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeGearRepo>

  beforeEach(async () => {
    db = new BrewDB('test-gear')
    await db.open()
    repo = makeGearRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-gear')
  })

  it('list() returns empty initially', async () => {
    expect(await repo.list()).toEqual([])
  })

  it('save + get round-trips', async () => {
    await repo.save(item)
    const fetched = await repo.get(item.id)
    expect(fetched?.name).toBe('B40 Pro')
  })

  it('list returns saved items', async () => {
    await repo.save(item)
    const all = await repo.list()
    expect(all).toHaveLength(1)
  })

  it('listByCategory filters', async () => {
    await repo.save(item)
    await repo.save({
      ...item,
      id: '550e8400-e29b-41d4-a716-446655440011',
      name: 'Stir plate',
      category: 'instrument',
    })
    const kettles = await repo.listByCategory('kettle')
    expect(kettles).toHaveLength(1)
    expect(kettles[0].name).toBe('B40 Pro')
  })

  it('delete removes the item', async () => {
    await repo.save(item)
    await repo.delete(item.id)
    expect(await repo.get(item.id)).toBeNull()
  })

  it('save rejects invalid items via Zod', async () => {
    await expect(repo.save({ ...item, name: '' } as never)).rejects.toThrow()
  })
})
