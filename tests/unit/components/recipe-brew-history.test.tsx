import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'

// Mutable fixture the mocked store reads at render time (the `mock` prefix is
// required for a variable referenced inside a hoisted `vi.mock` factory).
let mockBatches: Batch[] = []
vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({ batches: mockBatches, isLoading: false, setBatches: () => {} }),
}))

import { BrewHistory } from '@/components/recipe/recipe-brew-history'

const RID = '550e8400-e29b-41d4-a716-446655440000'
const FERM = '550e8400-e29b-41d4-a716-446655440001'
const HOP = '550e8400-e29b-41d4-a716-446655440002'

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: RID,
    name: 'Test IPA',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
    fermentables: [
      {
        ingredientId: FERM,
        snapshot: { name: 'Pale', type: 'base', ppg: 37, color_L: 2 },
        amount_kg: 5,
        usage: 'mash',
        afterBoil: false,
      },
    ],
    hops: [
      {
        ingredientId: HOP,
        snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' },
        amount_g: 30,
        time_min: 60,
        use: 'boil',
      },
    ],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    targets: { OG: 1.05 },
    notes_md: '',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function makeBatch(over: Partial<Batch> = {}): Batch {
  return {
    id: 'batch-x',
    batchNo: 1,
    name: 'Brew',
    status: 'complete',
    recipeId: RID,
    startedAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  } as Batch
}

beforeEach(() => {
  mockBatches = []
})

describe('BrewHistory', () => {
  it('shows the empty state when there are no brews', () => {
    mockBatches = []
    const html = renderToStaticMarkup(<BrewHistory recipe={makeRecipe()} />)
    expect(html).toContain('No brews yet')
  })

  it('only counts batches brewed from THIS recipe', () => {
    mockBatches = [
      makeBatch({ id: 'mine', batchNo: 7, recipeId: RID }),
      makeBatch({ id: 'other', batchNo: 8, recipeId: 'some-other-recipe' }),
    ]
    const html = renderToStaticMarkup(<BrewHistory recipe={makeRecipe()} />)
    expect(html).toContain('/logbook/view?id=mine')
    expect(html).not.toContain('/logbook/view?id=other')
  })

  it('lists brews newest-first with status, rating, and a View link', () => {
    mockBatches = [
      makeBatch({
        id: 'b1',
        batchNo: 1,
        status: 'complete',
        brewedAt: '2026-06-10T00:00:00.000Z',
        recipeSnapshot: makeRecipe({ batchSize_L: 20 }),
      }),
      makeBatch({
        id: 'b2',
        batchNo: 2,
        status: 'archived',
        tasting: { rating: 4 },
        brewedAt: '2026-06-20T00:00:00.000Z',
        recipeSnapshot: makeRecipe({ batchSize_L: 22 }),
      }),
    ]
    const html = renderToStaticMarkup(<BrewHistory recipe={makeRecipe({ batchSize_L: 22 })} />)
    // Newest (b2, Jun 20) is rendered before oldest (b1, Jun 10).
    expect(html.indexOf('/logbook/view?id=b2')).toBeLessThan(html.indexOf('/logbook/view?id=b1'))
    expect(html).toContain('batchlist-chip--archived')
    expect(html).toContain('batchlist-chip--complete')
    expect(html).toContain('4 of 5 stars')
    expect(html).toContain('/logbook/view?id=b1')
  })

  it('shows a per-brew diff vs the previous brew, and "First brew" for the oldest', () => {
    mockBatches = [
      makeBatch({
        id: 'b2',
        batchNo: 2,
        brewedAt: '2026-06-20T00:00:00.000Z',
        recipeSnapshot: makeRecipe({ batchSize_L: 22 }),
      }),
      makeBatch({
        id: 'b1',
        batchNo: 1,
        brewedAt: '2026-06-10T00:00:00.000Z',
        recipeSnapshot: makeRecipe({ batchSize_L: 20 }),
      }),
    ]
    const html = renderToStaticMarkup(<BrewHistory recipe={makeRecipe({ batchSize_L: 22 })} />)
    expect(html).toContain('First brew')
    expect(html).toContain('Batch size')
    expect(html).toContain('20')
    expect(html).toContain('22')
  })

  it('shows the "changed since last brew" callout when the recipe differs from the latest snapshot', () => {
    mockBatches = [
      makeBatch({
        id: 'b3',
        batchNo: 3,
        brewedAt: '2026-06-20T00:00:00.000Z',
        recipeSnapshot: makeRecipe({ batchSize_L: 20 }),
      }),
    ]
    const html = renderToStaticMarkup(<BrewHistory recipe={makeRecipe({ batchSize_L: 25 })} />)
    expect(html).toContain('Recipe changed since brew #3')
    expect(html).toContain('Batch size')
    expect(html).not.toContain('No changes since your last brew')
  })

  it('shows "no changes since last brew" when the recipe matches the latest snapshot', () => {
    mockBatches = [
      makeBatch({
        id: 'b5',
        batchNo: 5,
        brewedAt: '2026-06-20T00:00:00.000Z',
        recipeSnapshot: makeRecipe(),
      }),
    ]
    const html = renderToStaticMarkup(<BrewHistory recipe={makeRecipe()} />)
    expect(html).toContain('No changes since your last brew')
    expect(html).not.toContain('Recipe changed since brew')
  })

  it('does not crash when a brew is missing its recipeSnapshot', () => {
    mockBatches = [
      makeBatch({ id: 'b2', batchNo: 2, brewedAt: '2026-06-20T00:00:00.000Z' }),
      makeBatch({
        id: 'b1',
        batchNo: 1,
        brewedAt: '2026-06-10T00:00:00.000Z',
        recipeSnapshot: makeRecipe(),
      }),
    ]
    const render = () => renderToStaticMarkup(<BrewHistory recipe={makeRecipe()} />)
    expect(render).not.toThrow()
    expect(render()).toContain('/logbook/view?id=b2')
  })
})
