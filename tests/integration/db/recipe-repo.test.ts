import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { BrewDB } from '@/lib/db/schema'

const smash: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH Pale Ale',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-05-11T12:00:00.000Z',
  updatedAt: '2026-05-11T12:00:00.000Z',
  schemaVersion: 1,
}

describe('recipeRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeRecipeRepo>

  beforeEach(async () => {
    db = new BrewDB('test-recipes')
    await db.open()
    repo = makeRecipeRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-recipes')
  })

  it('list() returns empty initially', async () => {
    expect(await repo.list()).toEqual([])
  })

  it('save() updates updatedAt', async () => {
    const saved = await repo.save(smash)
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(smash.updatedAt).getTime(),
    )
  })

  it('list() orders by updatedAt descending', async () => {
    await repo.save({ ...smash, id: '550e8400-e29b-41d4-a716-446655440098', name: 'Older' })
    await new Promise((r) => setTimeout(r, 5))
    await repo.save({ ...smash, id: '550e8400-e29b-41d4-a716-446655440097', name: 'Newer' })
    const all = await repo.list()
    expect(all[0].name).toBe('Newer')
  })

  it('get() returns the saved recipe', async () => {
    await repo.save(smash)
    const fetched = await repo.get(smash.id)
    expect(fetched?.name).toBe('SMaSH Pale Ale')
  })

  it('delete() removes the recipe', async () => {
    await repo.save(smash)
    await repo.delete(smash.id)
    expect(await repo.get(smash.id)).toBeNull()
  })

  it('round-trips tags through save/get', async () => {
    const tagged = { ...smash, tags: ['house', 'ipa'] }
    await repo.save(tagged)
    const fetched = await repo.get(smash.id)
    expect(fetched?.tags).toEqual(['house', 'ipa'])
  })

  it('reads back a legacy recipe stored with no tags key', async () => {
    // Simulate a pre-tags row already sitting in the table.
    await db.recipes.put(smash)
    const fetched = await repo.get(smash.id)
    expect(fetched?.tags).toBeUndefined()
    expect(fetched?.name).toBe('SMaSH Pale Ale')
  })
})
