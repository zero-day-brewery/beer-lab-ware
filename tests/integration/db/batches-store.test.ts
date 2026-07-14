import { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { BrewDB } from '@/lib/db/schema'
import { useBatchesStore } from '@/stores/batches-store'

const recipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
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
const batch = (id: string, no: number): Batch => ({
  id,
  batchNo: no,
  name: `#${no}`,
  status: 'complete',
  recipeSnapshot: recipe,
  equipmentSnapshot: B40PRO_PROFILE,
  computedTargets: calculateRecipe(recipe, B40PRO_PROFILE, '2026-06-25T12:00:00.000Z'),
  process: [],
  logs: [],
  timers: [],
  results: {},
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
})

describe('batches liveQuery feed', () => {
  let db: BrewDB
  beforeEach(async () => {
    db = new BrewDB('test-batches-store')
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-batches-store')
  })

  it('emits batches newest-first and updates on save', async () => {
    const repo = makeBatchRepo(db)
    const seen: Batch[][] = []
    const sub = liveQuery(() => db.batches.orderBy('updatedAt').reverse().toArray()).subscribe({
      next: (rows) => seen.push(rows as Batch[]),
    })
    await repo.save(batch('11111111-1111-4111-8111-111111111111', 1))
    await new Promise((r) => setTimeout(r, 30))
    await repo.save(batch('22222222-2222-4222-8222-222222222222', 2))
    await new Promise((r) => setTimeout(r, 30))
    sub.unsubscribe()
    const final = seen.at(-1) ?? []
    expect(final.length).toBe(2)
    expect(final[0].batchNo).toBe(2)
  })
})

describe('useBatchesStore export', () => {
  it('exports a useBatchesStore hook', () => {
    expect(typeof useBatchesStore).toBe('function')
  })
})
