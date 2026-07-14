import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type BatchStats, buildBatchStats } from '@/lib/brewing/batch/batch-stats'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'

const NOW = new Date('2026-07-15T12:00:00.000Z')

function recipe(over: Partial<Recipe>): Recipe {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'IPA',
    type: 'all-grain',
    batchSize_L: 19,
    boilTime_min: 60,
    equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function batch(over: Partial<Batch> & { id: string }): Batch {
  return {
    batchNo: 1,
    name: 'Batch',
    status: 'in-progress',
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

describe('buildBatchStats — totals & status', () => {
  it('counts total and byStatus', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', status: 'in-progress' }),
        batch({ id: 'b', status: 'complete' }),
        batch({ id: 'c', status: 'complete' }),
        batch({ id: 'd', status: 'archived' }),
      ],
      NOW,
    )
    expect(s.total).toBe(4)
    expect(s.byStatus).toEqual({ 'in-progress': 1, complete: 2, archived: 1 })
  })
})

describe('buildBatchStats — brewedThisMonth / brewedThisYear', () => {
  it('buckets by brewedAt ?? startedAt against the injected now', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'this-month', brewedAt: '2026-07-10T00:00:00.000Z' }),
        batch({ id: 'this-year', brewedAt: '2026-03-05T00:00:00.000Z' }),
        batch({ id: 'prior-year', brewedAt: '2025-12-20T00:00:00.000Z' }),
        // brewedAt absent → falls back to startedAt (also this month)
        batch({ id: 'fallback', brewedAt: undefined, startedAt: '2026-07-02T00:00:00.000Z' }),
      ],
      NOW,
    )
    expect(s.brewedThisMonth).toBe(2) // this-month + fallback
    expect(s.brewedThisYear).toBe(3) // + this-year
  })
})

describe('buildBatchStats — avgMeasuredABV', () => {
  it('averages only batches that recorded a measuredABV', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', results: { measuredABV: 5 } }),
        batch({ id: 'b', results: { measuredABV: 6 } }),
        batch({ id: 'c', results: {} }), // no ABV → excluded
      ],
      NOW,
    )
    expect(s.avgMeasuredABV).toBe(5.5)
  })

  it('is null when no batch recorded an ABV', () => {
    const s = buildBatchStats([batch({ id: 'a' }), batch({ id: 'b' })], NOW)
    expect(s.avgMeasuredABV).toBeNull()
  })
})

describe('buildBatchStats — mostBrewedStyle', () => {
  it('groups by styleId when present (label from the recipe name)', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', recipeSnapshot: recipe({ styleId: '21a', name: 'Hazy IPA' }) }),
        batch({ id: 'b', recipeSnapshot: recipe({ styleId: '21a', name: 'West Coast IPA' }) }),
        batch({ id: 'c', recipeSnapshot: recipe({ styleId: '10a', name: 'Weizen' }) }),
      ],
      NOW,
    )
    expect(s.mostBrewedStyle).toEqual({ key: '21a', label: 'Hazy IPA', count: 2 })
  })

  it('falls back to the recipe name as the group key when no styleId', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', recipeSnapshot: recipe({ styleId: undefined, name: 'SMaSH' }) }),
        batch({ id: 'b', recipeSnapshot: recipe({ styleId: undefined, name: 'SMaSH' }) }),
      ],
      NOW,
    )
    expect(s.mostBrewedStyle).toEqual({ key: 'SMaSH', label: 'SMaSH', count: 2 })
  })

  it('breaks ties toward the first-seen style (deterministic)', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', recipeSnapshot: recipe({ styleId: 'first', name: 'First' }) }),
        batch({ id: 'b', recipeSnapshot: recipe({ styleId: 'second', name: 'Second' }) }),
      ],
      NOW,
    )
    expect(s.mostBrewedStyle?.key).toBe('first')
    expect(s.mostBrewedStyle?.count).toBe(1)
  })

  it('is null when no batch carries a recipe snapshot', () => {
    const s = buildBatchStats([batch({ id: 'a' })], NOW)
    expect(s.mostBrewedStyle).toBeNull()
  })
})

describe('buildBatchStats — mostBrewedType', () => {
  it('groups by recipeSnapshot.type', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', recipeSnapshot: recipe({ type: 'all-grain' }) }),
        batch({ id: 'b', recipeSnapshot: recipe({ type: 'all-grain' }) }),
        batch({ id: 'c', recipeSnapshot: recipe({ type: 'extract' }) }),
      ],
      NOW,
    )
    expect(s.mostBrewedType).toEqual({ type: 'all-grain', count: 2 })
  })

  it('is null when no snapshots', () => {
    expect(buildBatchStats([batch({ id: 'a' })], NOW).mostBrewedType).toBeNull()
  })
})

describe('buildBatchStats — lastBrewDate', () => {
  it('is the max brewedAt ?? startedAt across batches', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', brewedAt: '2026-05-01T00:00:00.000Z' }),
        batch({ id: 'b', brewedAt: '2026-07-09T00:00:00.000Z' }),
        batch({ id: 'c', brewedAt: undefined, startedAt: '2026-06-15T00:00:00.000Z' }),
      ],
      NOW,
    )
    expect(s.lastBrewDate).toBe('2026-07-09T00:00:00.000Z')
  })
})

describe('buildBatchStats — avgRating', () => {
  it('averages tasting.rating (0 is a real value)', () => {
    const s = buildBatchStats(
      [
        batch({ id: 'a', tasting: { rating: 4 } }),
        batch({ id: 'b', tasting: { rating: 0 } }),
        batch({ id: 'c' }), // unrated → excluded
      ],
      NOW,
    )
    expect(s.avgRating).toBe(2)
  })

  it('is null when nothing is rated', () => {
    expect(buildBatchStats([batch({ id: 'a' }), batch({ id: 'b' })], NOW).avgRating).toBeNull()
  })
})

describe('buildBatchStats — empty', () => {
  it('returns zeros and nulls for no batches', () => {
    const s: BatchStats = buildBatchStats([], NOW)
    expect(s).toEqual({
      total: 0,
      byStatus: { 'in-progress': 0, complete: 0, archived: 0 },
      brewedThisMonth: 0,
      brewedThisYear: 0,
      avgMeasuredABV: null,
      mostBrewedStyle: null,
      mostBrewedType: null,
      lastBrewDate: null,
      avgRating: null,
    })
  })
})

describe('buildBatchStats — purity', () => {
  it('imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/batch/batch-stats.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
