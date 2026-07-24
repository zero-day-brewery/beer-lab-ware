import { afterEach, describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { type DumpV10, makeBackupService } from '@/lib/db/backup'
import { BrewDB } from '@/lib/db/schema'

const dbs: BrewDB[] = []
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})
function freshDb(): BrewDB {
  const d = new BrewDB(`restore-board-${Date.now()}-${dbs.length}`)
  dbs.push(d)
  return d
}

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

function inProgressOnF1(id: string, batchNo: number, updatedAt: string): Batch {
  return {
    id,
    batchNo,
    name: `SMaSH #${batchNo}`,
    status: 'in-progress',
    fermenterBoardId: 'f1',
    recipeSnapshot: recipe,
    equipmentSnapshot: B40PRO_PROFILE,
    computedTargets: calculateRecipe(recipe, B40PRO_PROFILE, '2026-06-25T12:00:00.000Z'),
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-06-25T12:00:00.000Z',
    updatedAt,
    schemaVersion: 1,
  }
}

function dumpWith(batches: Batch[]): DumpV10 {
  return {
    version: 10,
    exportedAt: '2026-07-23T00:00:00.000Z',
    meta: { dumpVersion: 10, dbVersion: 12, schemaVersion: 1, rowCounts: {} },
    tables: {
      recipes: [],
      equipmentProfiles: [],
      ingredients: [],
      settings: [],
      inventoryItems: [],
      gearItems: [],
      waterProfiles: [],
      batches,
      brewSessions: [],
      brewTimers: [],
      readings: [],
      stockTransactions: [],
      seedTombstones: [],
      yeastLots: [],
      rowTombstones: [],
      deviceLinks: [],
    },
  } as unknown as DumpV10
}

describe('restore() — board-conflict repair', () => {
  it('imports a dirty backup (two in-progress on one vessel) with ZERO rows lost; loser archived', async () => {
    const db = freshDb()
    // Same board, both in-progress — the corrupt/merged state the invariant forbids.
    // The higher-batchNo batch is the deterministic winner (immutable-field ranking).
    const winner = inProgressOnF1(
      '11111111-1111-4111-8111-111111111111',
      2,
      '2026-07-05T00:00:00.000Z',
    )
    const loser = inProgressOnF1(
      '22222222-2222-4222-8222-222222222222',
      1,
      '2026-07-10T00:00:00.000Z',
    )

    await makeBackupService(db).restore(dumpWith([winner, loser]))

    const rows = await db.batches.toArray()
    expect(rows).toHaveLength(2) // nothing deleted — data-loss-free repair
    expect(rows.filter((r) => r.status === 'in-progress')).toHaveLength(1)
    expect(rows.filter((r) => r.status === 'archived')).toHaveLength(1)
    // The higher-batchNo batch survives in-progress; the loser is archived, not lost.
    expect(rows.find((r) => r.status === 'in-progress')?.id).toBe(winner.id)
  })

  it('leaves a clean backup untouched (idempotent — one in-progress per vessel)', async () => {
    const db = freshDb()
    const only = inProgressOnF1(
      '33333333-3333-4333-8333-333333333333',
      1,
      '2026-07-10T00:00:00.000Z',
    )
    await makeBackupService(db).restore(dumpWith([only]))

    const rows = await db.batches.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('in-progress')
  })
})
