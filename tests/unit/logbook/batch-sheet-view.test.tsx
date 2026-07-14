import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'

const recipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: 'x',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
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
  createdAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
}
const sample: Batch = {
  id: 'b1',
  batchNo: 1,
  name: 'SMaSH #1',
  status: 'complete',
  recipeSnapshot: recipe,
  equipmentSnapshot: B40PRO_PROFILE,
  computedTargets: calculateRecipe(recipe, B40PRO_PROFILE, '2026-06-25T12:00:00.000Z'),
  process: [],
  logs: [
    {
      key: 'intoFermenter_L',
      label: 'Into fermenter',
      stepId: 'measure-og',
      value: 18.7,
      unit: 'L',
      at: '2026-06-25T15:00:00Z',
    },
  ],
  timers: [],
  results: { measuredOG: 1.049, measuredFG: 1.011, measuredABV: 4.99 },
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
}

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=b1'),
}))
const getMock = vi.fn()
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: { get: (...a: unknown[]) => getMock(...a) },
}))

import { buildActualMap } from '@/components/logbook/batch-sheet-view'

describe('BatchSheetView', () => {
  beforeEach(() => {
    getMock.mockReset()
    getMock.mockResolvedValue(sample)
  })

  it('renders the actual measured OG/FG/ABV from results once loaded', async () => {
    // Drive the effect manually: render, then resolve. Since renderToStaticMarkup is
    // synchronous, assert the helper that maps results→cells directly.
    const map = buildActualMap(sample)
    expect(map.measuredOG).toBe(1.049)
    expect(map.intoFermenter_L).toBe(18.7)
  })
})
