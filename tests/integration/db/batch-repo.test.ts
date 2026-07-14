import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { BrewDB } from '@/lib/db/schema'

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

function batch(id: string, batchNo: number, status: Batch['status'] = 'complete'): Batch {
  return {
    id,
    batchNo,
    name: `SMaSH #${batchNo}`,
    status,
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
  }
}

describe('batchRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeBatchRepo>

  beforeEach(async () => {
    db = new BrewDB('test-batches')
    await db.open()
    repo = makeBatchRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-batches')
  })

  it('save() validates + stamps updatedAt; get() round-trips through Zod', async () => {
    const saved = await repo.save(batch('11111111-1111-4111-8111-111111111111', 1))
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(0)
    const fetched = await repo.get(saved.id)
    expect(fetched?.batchNo).toBe(1)
    expect(fetched?.name).toBe('SMaSH #1')
  })

  it('round-trips a tasting rating + notes through save()/get()', async () => {
    const b = batch('66666666-6666-4666-8666-666666666666', 4)
    b.tasting = { rating: 4, overall_md: 'Balanced, clean bitterness.' }
    const saved = await repo.save(b)
    expect(saved.tasting?.rating).toBe(4)
    const fetched = await repo.get(saved.id)
    expect(fetched?.tasting?.rating).toBe(4)
    expect(fetched?.tasting?.overall_md).toBe('Balanced, clean bitterness.')
  })

  it('nextBatchNo() returns 1 on an empty table', async () => {
    expect(await repo.nextBatchNo()).toBe(1)
  })

  it('nextBatchNo() returns max(batchNo) + 1', async () => {
    await repo.save(batch('11111111-1111-4111-8111-111111111111', 3))
    await repo.save(batch('22222222-2222-4222-8222-222222222222', 7))
    expect(await repo.nextBatchNo()).toBe(8)
  })

  it('nextBatchNo() is computed at runtime, not cached (collision-proof)', async () => {
    await repo.save(batch('11111111-1111-4111-8111-111111111111', 1))
    const a = await repo.nextBatchNo() // 2
    await repo.save(batch('22222222-2222-4222-8222-222222222222', a))
    const b = await repo.nextBatchNo() // must see the newly-saved row → 3
    expect(a).toBe(2)
    expect(b).toBe(3)
  })

  it('getActive() finds the single in-progress batch via filter (not boolean where)', async () => {
    await repo.save(batch('11111111-1111-4111-8111-111111111111', 1, 'complete'))
    await repo.save(batch('22222222-2222-4222-8222-222222222222', 2, 'in-progress'))
    const active = await repo.getActive()
    expect(active?.batchNo).toBe(2)
  })

  it('getByBoard() returns the in-progress batch on a fermenter slot', async () => {
    const b = batch('33333333-3333-4333-8333-333333333333', 5, 'in-progress')
    b.fermenterBoardId = 'f2'
    await repo.save(b)
    const found = await repo.getByBoard('f2')
    expect(found?.batchNo).toBe(5)
    expect(await repo.getByBoard('f4')).toBeNull()
  })

  it('getByBoard() resolves each vessel to ITS OWN batch when two brews run concurrently', async () => {
    // Two in-progress batches on different vessels — the multi-vessel correctness case.
    const onF1 = batch('44444444-4444-4444-8444-444444444444', 8, 'in-progress')
    onF1.fermenterBoardId = 'f1'
    const onF3 = batch('55555555-5555-4555-8555-555555555555', 9, 'in-progress')
    onF3.fermenterBoardId = 'f3'
    await repo.save(onF1)
    await repo.save(onF3)

    // Each board resolves to its own batch — NOT the first-active (which getActive would return).
    expect((await repo.getByBoard('f1'))?.batchNo).toBe(8)
    expect((await repo.getByBoard('f3'))?.batchNo).toBe(9)
    // getActive() would collapse both to whichever the filter hits first — proving why
    // the runner must rehydrate by board, not by first-active.
    const firstActive = await repo.getActive()
    expect(firstActive?.status).toBe('in-progress')
  })
})
