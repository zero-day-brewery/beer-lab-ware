import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { makeInventoryRepo } from '@/lib/db/repos/inventory'
import { BrewDB } from '@/lib/db/schema'

const item: InventoryItem = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  name: 'Cascade pellets 2024',
  ingredientKind: 'hop',
  amount: 227,
  amountUnit: 'g',
  status: 'sealed',
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('inventoryRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeInventoryRepo>

  beforeEach(async () => {
    db = new BrewDB('test-inventory')
    await db.open()
    repo = makeInventoryRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-inventory')
  })

  it('list() returns empty initially', async () => {
    expect(await repo.list()).toEqual([])
  })

  it('save + get round-trips', async () => {
    await repo.save(item)
    const fetched = await repo.get(item.id)
    expect(fetched?.name).toBe('Cascade pellets 2024')
  })

  it('listByKind filters', async () => {
    await repo.save(item)
    await repo.save({
      ...item,
      id: '550e8400-e29b-41d4-a716-446655440021',
      name: '2-Row Pale',
      ingredientKind: 'fermentable',
      amount: 25,
      amountUnit: 'lb',
    })
    const hops = await repo.listByKind('hop')
    expect(hops).toHaveLength(1)
    expect(hops[0].name).toBe('Cascade pellets 2024')
  })

  it('delete removes the item', async () => {
    await repo.save(item)
    await repo.delete(item.id)
    expect(await repo.get(item.id)).toBeNull()
  })

  it('save rejects invalid items via Zod', async () => {
    await expect(repo.save({ ...item, amount: -1 } as never)).rejects.toThrow()
  })

  it('round-trips the additive openedDate + parLevel fields', async () => {
    await repo.save({
      ...item,
      status: 'opened',
      openedDate: '2026-06-01T00:00:00.000Z',
      parLevel: 340,
    })
    const fetched = await repo.get(item.id)
    expect(fetched?.openedDate).toBe('2026-06-01T00:00:00.000Z')
    expect(fetched?.parLevel).toBe(340)
  })
})
