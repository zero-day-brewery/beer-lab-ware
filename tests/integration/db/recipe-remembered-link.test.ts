import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyRememberedLinks, type DeductionLine } from '@/lib/brewing/inventory/deduction'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { BrewDB } from '@/lib/db/schema'

const NOW = '2026-07-05T00:00:00.000Z'
const RECIPE_ID = 'e0000000-0000-4000-8000-000000000000'
const FERM_ID = 'f0000000-0000-4000-8000-000000000001'
const ITEM_ID = 'a0000000-0000-4000-8000-000000000001'

function recipe(): Recipe {
  return {
    id: RECIPE_ID,
    name: 'Test IPA',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: 'e0000000-0000-4000-8000-0000000000ee',
    fermentables: [
      {
        ingredientId: FERM_ID,
        snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
        amount_kg: 5,
        usage: 'mash',
        afterBoil: false,
      },
    ],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
  }
}

const matchedLine: DeductionLine = {
  ingredientId: FERM_ID,
  line: 'fermentable',
  name: '2-Row Pale',
  recipeQty: 5,
  recipeUnit: 'kg',
  inventoryKind: 'fermentable',
  matchedItemId: ITEM_ID,
  matchedItem: null,
  draw: 5,
  drawUnit: 'kg',
  resultingBalance: 5,
  status: 'ok',
  candidates: [],
  recipeUseRef: { ingredientId: FERM_ID, line: 'fermentable' },
}

describe('remembered-link write-back through recipeRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeRecipeRepo>

  beforeEach(async () => {
    db = new BrewDB('test-remembered-link')
    await db.open()
    repo = makeRecipeRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-remembered-link')
  })

  it('get → applyRememberedLinks → save persists inventoryItemId onto the live use', async () => {
    await repo.save(recipe())
    const live = await repo.get(RECIPE_ID)
    expect(live).not.toBeNull()
    const { recipe: next, changed } = applyRememberedLinks(live as Recipe, [matchedLine])
    expect(changed).toBe(true)
    await repo.save(next)

    const reread = await repo.get(RECIPE_ID)
    expect(reread?.fermentables[0].inventoryItemId).toBe(ITEM_ID)
  })

  it('no-op when the recipe is absent (get returns null → skip)', async () => {
    // Mirrors the component guard: a deleted recipe yields null and we never save.
    const missing = await repo.get(RECIPE_ID)
    expect(missing).toBeNull()
    // Nothing to write; the ledger deduction already succeeded independently.
  })
})
