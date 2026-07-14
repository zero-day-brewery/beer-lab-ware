// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { maxSeverity, severityTint, useInsights } from '@/components/ai/use-insights'
import { buildInsights } from '@/lib/brewing/insights/detectors'
import type { Insight } from '@/lib/brewing/insights/types'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()

// ── fixtures (mirrors the detectors test — fields read directly, no Zod parse) ──

let seq = 0
const uid = () => `id-${seq++}`

function batch(over: Partial<Batch> & { id: string }): Batch {
  return {
    batchNo: 1,
    name: 'Test Batch',
    status: 'in-progress',
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: daysAgo(6),
    updatedAt: daysAgo(1),
    schemaVersion: 1,
    ...over,
  } as Batch
}
function withFG(fg: number): Pick<Batch, 'recipeSnapshot'> {
  return { recipeSnapshot: { targets: { FG: fg } } as unknown as Recipe }
}
function reading(batchId: string, daysAgoN: number, gravity?: number): Reading {
  return { id: uid(), batchId, at: daysAgo(daysAgoN), gravity, schemaVersion: 1 }
}
function inv(p: Partial<InventoryItem>): InventoryItem {
  return {
    id: uid(),
    name: 'Ingredient',
    ingredientKind: 'other',
    amount: 1,
    amountUnit: 'each',
    status: 'sealed',
    notes_md: '',
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
    schemaVersion: 1,
    ...p,
  } as InventoryItem
}

// A data set that fires all three severities:
//  - stuck fermentation (urgent): flat far above FG for 6 days
//  - out of stock (urgent): 0 on hand under a threshold
//  - old hops (warn): >12 months in cold storage
//  - aging hops (info): 6–12 months
const stuck = batch({ id: 'b1', name: 'Stuck IPA', startedAt: daysAgo(6), ...withFG(1.008) })
const readingsB1 = [reading('b1', 5, 1.03), reading('b1', 3, 1.031), reading('b1', 0, 1.03)]
const outOfStock = inv({
  name: 'Pilsner Malt',
  ingredientKind: 'fermentable',
  amount: 0,
  amountUnit: 'g',
  lowStockThreshold: 5000,
})
const oldHop = inv({
  name: 'Old Citra',
  ingredientKind: 'hop',
  amount: 200,
  amountUnit: 'g',
  purchaseDate: daysAgo(400),
})
const agingHop = inv({
  name: 'Amarillo',
  ingredientKind: 'hop',
  amount: 150,
  amountUnit: 'g',
  purchaseDate: daysAgo(240),
})

const loadFrom =
  (map: Record<string, Reading[]>) =>
  async (id: string): Promise<Reading[]> =>
    map[id] ?? []

describe('useInsights', () => {
  it('reproduces buildInsights over the injected data once readings load', async () => {
    const opts = {
      batches: [stuck],
      inventory: [outOfStock, oldHop, agingHop],
      loadReadings: loadFrom({ b1: readingsB1 }),
      now: () => NOW,
    }
    const { result } = renderHook(() => useInsights(opts))

    // Wait until the readings-derived (stuck) insight has been folded in.
    await waitFor(() =>
      expect(result.current.insights.some((i) => i.kind === 'stuck_fermentation')).toBe(true),
    )

    const expected = buildInsights({
      batches: [stuck],
      readingsByBatch: { b1: readingsB1 },
      inventory: [outOfStock, oldHop, agingHop],
      now: NOW,
    })
    // Same insights, same ranking (severity → recency → id) — the hook is a
    // thin surfacing layer over the pure engine, not a reimplementation.
    expect(result.current.insights.map((i) => i.id)).toEqual(expected.map((i) => i.id))
    // Covers every severity so the badge/panel tint mapping has real inputs.
    expect(new Set(result.current.insights.map((i) => i.severity))).toEqual(
      new Set(['urgent', 'warn', 'info']),
    )
  })

  it('dismiss(id) drops exactly that insight for the session', async () => {
    const opts = {
      batches: [stuck],
      inventory: [outOfStock, oldHop, agingHop],
      loadReadings: loadFrom({ b1: readingsB1 }),
      now: () => NOW,
    }
    const { result } = renderHook(() => useInsights(opts))
    await waitFor(() =>
      expect(result.current.insights.some((i) => i.kind === 'stuck_fermentation')).toBe(true),
    )

    const before = result.current.insights.length
    const target = result.current.insights[0].id

    act(() => result.current.dismiss(target))

    await waitFor(() =>
      expect(result.current.insights.find((i) => i.id === target)).toBeUndefined(),
    )
    expect(result.current.insights.length).toBe(before - 1)
    // Dismissing the same id twice is a no-op (idempotent).
    act(() => result.current.dismiss(target))
    expect(result.current.insights.length).toBe(before - 1)
  })

  it('loads readings ONLY for in-progress batches', async () => {
    const loadReadings = vi.fn(loadFrom({ b1: readingsB1 }))
    const done = batch({ id: 'done', name: 'Bottled Stout', status: 'complete' })
    renderHook(() =>
      useInsights({ batches: [stuck, done], inventory: [], loadReadings, now: () => NOW }),
    )

    await waitFor(() => expect(loadReadings).toHaveBeenCalledWith('b1'))
    expect(loadReadings).not.toHaveBeenCalledWith('done')
  })

  it('returns no insights (and never loads readings) for empty data', async () => {
    const loadReadings = vi.fn(loadFrom({}))
    const { result } = renderHook(() =>
      useInsights({ batches: [], inventory: [], loadReadings, now: () => NOW }),
    )
    await waitFor(() => expect(result.current.insights).toEqual([]))
    expect(loadReadings).not.toHaveBeenCalled()
  })
})

describe('badge/panel severity helpers', () => {
  const of = (severity: Insight['severity']): Insight =>
    ({ id: severity, kind: 'low_stock', severity, title: 't', detail: 'd' }) as Insight

  it('maxSeverity picks the most urgent present, null when empty', () => {
    expect(maxSeverity([])).toBeNull()
    expect(maxSeverity([of('info'), of('warn')])).toBe('warn')
    expect(maxSeverity([of('info'), of('urgent'), of('warn')])).toBe('urgent')
    expect(maxSeverity([of('info')])).toBe('info')
  })

  it('severityTint is a traffic-light map onto the .mini-alert tints', () => {
    expect(severityTint('urgent')).toBe('warn') // ember red
    expect(severityTint('warn')).toBe('info') // malt amber
    expect(severityTint('info')).toBe('go') // hop green
  })
})
