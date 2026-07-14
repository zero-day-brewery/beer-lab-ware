import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Fermentable, Hop } from '@/lib/brewing/types/ingredient'
import { makeIngredientRepo } from '@/lib/db/repos/ingredient'
import { BrewDB } from '@/lib/db/schema'

const cascade: Hop = {
  id: '550e8400-e29b-41d4-a716-446655440200',
  kind: 'hop',
  name: 'Cascade',
  alphaAcid_pct: 5.5,
  beta_pct: 6,
  type: 'dual',
  substitutes: [],
  origin: 'US',
  notes_md: '',
}

const tworow: Fermentable = {
  id: '550e8400-e29b-41d4-a716-446655440100',
  kind: 'fermentable',
  name: '2-Row Pale',
  type: 'base',
  ppg: 37,
  color_L: 2,
  origin: 'US',
  supplier: 'Briess',
  maxInBatch_pct: 100,
  notes_md: '',
}

describe('ingredientRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeIngredientRepo>

  beforeEach(async () => {
    db = new BrewDB('test-ingredients')
    await db.open()
    repo = makeIngredientRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-ingredients')
  })

  it('list() returns empty initially', async () => {
    expect(await repo.list()).toEqual([])
  })

  it('save + list returns both kinds', async () => {
    await repo.save(cascade)
    await repo.save(tworow)
    const all = await repo.list()
    expect(all).toHaveLength(2)
  })

  it('listByKind() filters by kind', async () => {
    await repo.save(cascade)
    await repo.save(tworow)
    const hops = await repo.listByKind('hop')
    expect(hops).toHaveLength(1)
    expect(hops[0].name).toBe('Cascade')
  })

  it('search() matches by name prefix within kind', async () => {
    await repo.save(cascade)
    const results = await repo.search('hop', 'Casc')
    expect(results).toHaveLength(1)
  })

  it('delete() removes the ingredient', async () => {
    await repo.save(cascade)
    await repo.delete(cascade.id)
    expect(await repo.get(cascade.id)).toBeNull()
  })
})
