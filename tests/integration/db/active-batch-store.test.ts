import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { BrewDB } from '@/lib/db/schema'
import { makeActiveBatchController } from '@/stores/active-batch-store'

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
const seed = (): Batch => ({
  id: '99999999-9999-4999-8999-999999999999',
  batchNo: 1,
  name: 'Active',
  status: 'in-progress',
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

describe('active-batch controller', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeBatchRepo>

  beforeEach(async () => {
    db = new BrewDB('test-active-batch')
    await db.open()
    repo = makeBatchRepo(db)
    // Only fake setTimeout/clearTimeout — fake-indexeddb uses IndexedDB transactions
    // internally which may use other async primitives we must not intercept.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(async () => {
    vi.useRealTimers()
    db.close()
    await BrewDB.delete('test-active-batch')
  })

  it('patch() coalesces writes and persists once after the debounce window', async () => {
    const ctrl = makeActiveBatchController(repo, { debounceMs: 1500 })
    ctrl.setActive(seed())
    ctrl.patch({ name: 'A' })
    ctrl.patch({ name: 'B' })
    ctrl.patch({ name: 'C' })
    // nothing written yet
    expect(await repo.get(seed().id)).toBeNull()
    await vi.advanceTimersByTimeAsync(1500)
    const saved = await repo.get(seed().id)
    expect(saved?.name).toBe('C')
  })

  it('flush() writes immediately (milestone), bypassing the debounce', async () => {
    const ctrl = makeActiveBatchController(repo, { debounceMs: 1500 })
    ctrl.setActive(seed())
    ctrl.patch({ results: { measuredOG: 1.05 } })
    await ctrl.flush()
    const saved = await repo.get(seed().id)
    expect(saved?.results.measuredOG).toBe(1.05)
  })

  it('loadActive() rehydrates the in-progress batch from Dexie', async () => {
    await repo.save(seed())
    const ctrl = makeActiveBatchController(repo, { debounceMs: 1500 })
    const loaded = await ctrl.loadActive()
    expect(loaded?.id).toBe(seed().id)
    expect(ctrl.get()?.name).toBe('Active')
  })

  it('clear() drops the in-memory active batch without deleting the row', async () => {
    const ctrl = makeActiveBatchController(repo, { debounceMs: 1500 })
    ctrl.setActive(seed())
    await ctrl.flush()
    ctrl.clear()
    expect(ctrl.get()).toBeNull()
    expect(await repo.get(seed().id)).not.toBeNull()
  })
})
