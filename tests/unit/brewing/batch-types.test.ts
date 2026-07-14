import { describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'

const recipe: Recipe = {
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
  createdAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
}

function makeBatch(): Batch {
  const computedTargets = calculateRecipe(recipe, B40PRO_PROFILE, '2026-06-25T12:00:00.000Z')
  return {
    id: '11111111-1111-4111-8111-111111111111',
    batchNo: 1,
    name: 'SMaSH #1',
    status: 'in-progress',
    recipeSnapshot: recipe,
    equipmentSnapshot: B40PRO_PROFILE,
    computedTargets,
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-06-25T12:00:00.000Z',
    updatedAt: '2026-06-25T12:00:00.000Z',
    schemaVersion: 1,
  }
}

describe('BatchSchema', () => {
  it('parses a minimal valid in-progress batch', () => {
    const b = makeBatch()
    expect(() => BatchSchema.parse(b)).not.toThrow()
    expect(BatchSchema.parse(b).batchNo).toBe(1)
  })

  it('round-trips logs with denormalized target + carb results', () => {
    const b = makeBatch()
    b.status = 'complete'
    b.logs = [
      {
        key: 'og',
        label: 'OG',
        stepId: 'measure-og',
        value: 1.048,
        target: 1.048,
        at: '2026-06-25T15:00:00.000Z',
      },
    ]
    b.results = {
      measuredOG: 1.048,
      measuredFG: 1.012,
      measuredABV: 4.73,
      carbMethod: 'co2-set-and-wait',
      targetCo2_vol: 2.4,
      spundingSetpoint_psi: 12,
    }
    const parsed = BatchSchema.parse(b)
    expect(parsed.logs[0].target).toBe(1.048)
    expect(parsed.results.carbMethod).toBe('co2-set-and-wait')
  })

  it('rejects a bad status enum', () => {
    const b = makeBatch() as unknown as { status: string }
    b.status = 'frozen'
    expect(() => BatchSchema.parse(b)).toThrow()
  })

  it('rejects a non-literal schemaVersion', () => {
    const b = makeBatch() as unknown as { schemaVersion: number }
    b.schemaVersion = 2
    expect(() => BatchSchema.parse(b)).toThrow()
  })

  // tasting.rating (0–5, optional, additive) — legacy batches without it must parse.
  it('accepts a tasting rating of 0 through 5', () => {
    for (const r of [0, 1, 2, 3, 4, 5]) {
      const b = makeBatch()
      b.tasting = { rating: r, overall_md: 'Solid.' }
      expect(() => BatchSchema.parse(b)).not.toThrow()
      expect(BatchSchema.parse(b).tasting?.rating).toBe(r)
    }
  })

  it('rejects a rating above 5, below 0, or non-integer', () => {
    for (const bad of [6, -1, 2.5]) {
      const b = makeBatch() as unknown as { tasting: { rating: number } }
      b.tasting = { rating: bad }
      expect(() => BatchSchema.parse(b)).toThrow()
    }
  })

  it('parses a legacy batch with no rating (and no tasting at all)', () => {
    const noTasting = makeBatch()
    expect(noTasting.tasting).toBeUndefined()
    expect(() => BatchSchema.parse(noTasting)).not.toThrow()
    expect(BatchSchema.parse(noTasting).tasting).toBeUndefined()

    const notesOnly = makeBatch()
    notesOnly.tasting = { overall_md: 'Clean, no rating recorded.' }
    const parsed = BatchSchema.parse(notesOnly)
    expect(parsed.tasting?.rating).toBeUndefined()
    expect(parsed.tasting?.overall_md).toBe('Clean, no rating recorded.')
  })

  // fermenterBoardId was widened from z.enum(['f1'..'f4']) to z.string() so that
  // user-added fermenters (uuid ids) can be linked. The change is additive.
  it('accepts a uuid fermenterBoardId (user-added vessel) AND still accepts f1', () => {
    const uuid = makeBatch()
    uuid.fermenterBoardId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
    expect(() => BatchSchema.parse(uuid)).not.toThrow()
    expect(BatchSchema.parse(uuid).fermenterBoardId).toBe('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')

    const legacy = makeBatch()
    legacy.fermenterBoardId = 'f1'
    expect(() => BatchSchema.parse(legacy)).not.toThrow()
    expect(BatchSchema.parse(legacy).fermenterBoardId).toBe('f1')
  })
})
