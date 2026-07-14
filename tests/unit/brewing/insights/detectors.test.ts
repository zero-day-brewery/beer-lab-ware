import { describe, expect, it } from 'vitest'
import {
  buildInsights,
  detectAgingHops,
  detectLowStock,
  detectReadyToPackage,
  detectStuckFermentation,
  type InsightContext,
} from '@/lib/brewing/insights/detectors'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()

// ── fixtures (detectors read fields directly — no Zod parse — so light casts ok) ──

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
  }
}

/** Attach a target FG via the recipe snapshot (spec's `recipeSnapshot.targets.FG`). */
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
  }
}

function ctx(over: Partial<InsightContext>): InsightContext {
  return { batches: [], readingsByBatch: {}, inventory: [], now: NOW, ...over }
}

// ── stuck_fermentation ──────────────────────────────────────────────────────

describe('detectStuckFermentation', () => {
  it('fires (urgent) when flat far above FG for >= 4 days', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.008) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: {
          b1: [reading('b1', 5, 1.03), reading('b1', 3, 1.031), reading('b1', 0, 1.03)],
        },
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('stuck_fermentation')
    expect(out[0].severity).toBe('urgent') // 22 points above FG
    expect(out[0].id).toBe('stuck_fermentation:b1')
    expect(out[0].relatedType).toBe('batch')
    expect(out[0].relatedId).toBe('b1')
    expect(out[0].ask).toBeTruthy()
    expect(out[0].at).toBe(daysAgo(0))
  })

  it('fires (warn) when moderately above FG (10–20 points)', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 4, 1.025), reading('b1', 0, 1.025)] },
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warn') // 15 points above FG
  })

  it('stays quiet while gravity is still dropping', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 4, 1.05), reading('b1', 0, 1.03)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet when already at/near FG (ready territory, not stuck)', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 4, 1.011), reading('b1', 0, 1.01)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet before 4 days of fermentation', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(2), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 2, 1.03), reading('b1', 0, 1.03)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet when there is no target FG', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6) }) // no recipeSnapshot/computedTargets
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 5, 1.03), reading('b1', 0, 1.03)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('falls back to computedTargets.FG when the recipe snapshot has none', () => {
    const b = batch({
      id: 'b1',
      startedAt: daysAgo(6),
      computedTargets: { FG: 1.008 } as unknown as Batch['computedTargets'],
    })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 5, 1.03), reading('b1', 0, 1.03)] },
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('stuck_fermentation')
  })

  it('stays quiet with fewer than two gravity readings', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({ batches: [b], readingsByBatch: { b1: [reading('b1', 0, 1.03)] } }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet when readings do not span >= 2 days (no real trend)', () => {
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 0.5, 1.03), reading('b1', 0, 1.03)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('ignores non-in-progress batches', () => {
    const b = batch({ id: 'b1', status: 'complete', startedAt: daysAgo(6), ...withFG(1.01) })
    const out = detectStuckFermentation(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 5, 1.03), reading('b1', 0, 1.03)] },
      }),
    )
    expect(out).toEqual([])
  })
})

// ── ready_to_package ────────────────────────────────────────────────────────

describe('detectReadyToPackage', () => {
  it('fires (info) when stable at FG for a couple days', () => {
    const b = batch({ id: 'b1', ...withFG(1.01) })
    const out = detectReadyToPackage(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 3, 1.011), reading('b1', 0, 1.01)] },
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ready_to_package')
    expect(out[0].severity).toBe('info')
    expect(out[0].id).toBe('ready_to_package:b1')
    expect(out[0].at).toBe(daysAgo(0))
  })

  it('stays quiet while still dropping through FG', () => {
    const b = batch({ id: 'b1', ...withFG(1.01) })
    const out = detectReadyToPackage(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 3, 1.02), reading('b1', 0, 1.011)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet when still well above FG', () => {
    const b = batch({ id: 'b1', ...withFG(1.01) })
    const out = detectReadyToPackage(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 3, 1.02), reading('b1', 0, 1.02)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet without a >= 2-day stable span', () => {
    const b = batch({ id: 'b1', ...withFG(1.01) })
    const out = detectReadyToPackage(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 0.5, 1.01), reading('b1', 0, 1.01)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('stays quiet without a target FG', () => {
    const b = batch({ id: 'b1' })
    const out = detectReadyToPackage(
      ctx({
        batches: [b],
        readingsByBatch: { b1: [reading('b1', 3, 1.01), reading('b1', 0, 1.01)] },
      }),
    )
    expect(out).toEqual([])
  })

  it('does not double-fire with stuck on the same batch', () => {
    // Flat far above FG -> stuck fires, ready must not.
    const b = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.008) })
    const c = ctx({
      batches: [b],
      readingsByBatch: { b1: [reading('b1', 4, 1.03), reading('b1', 0, 1.03)] },
    })
    expect(detectStuckFermentation(c)).toHaveLength(1)
    expect(detectReadyToPackage(c)).toEqual([])
  })
})

// ── aging_hops ──────────────────────────────────────────────────────────────

describe('detectAgingHops', () => {
  it('fires (info) for hops in the 6–12 month aging band', () => {
    const hop = inv({ ingredientKind: 'hop', name: 'Citra', purchaseDate: daysAgo(240) })
    const out = detectAgingHops(ctx({ inventory: [hop] }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('aging_hops')
    expect(out[0].severity).toBe('info')
    expect(out[0].relatedType).toBe('inventory')
    expect(out[0].at).toBe(daysAgo(240))
  })

  it('fires (warn) for hops older than 12 months', () => {
    const hop = inv({ ingredientKind: 'hop', name: 'Simcoe', purchaseDate: daysAgo(430) })
    const out = detectAgingHops(ctx({ inventory: [hop] }))
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warn')
  })

  it('stays quiet for fresh hops (< 6 months)', () => {
    const hop = inv({ ingredientKind: 'hop', name: 'Mosaic', purchaseDate: daysAgo(60) })
    expect(detectAgingHops(ctx({ inventory: [hop] }))).toEqual([])
  })

  it('ignores non-hop ingredients even when old', () => {
    const grain = inv({
      ingredientKind: 'fermentable',
      name: 'Maris Otter',
      purchaseDate: daysAgo(430),
    })
    expect(detectAgingHops(ctx({ inventory: [grain] }))).toEqual([])
  })

  it('ignores hops without a purchase date', () => {
    const hop = inv({ ingredientKind: 'hop', name: 'Cascade', purchaseDate: undefined })
    expect(detectAgingHops(ctx({ inventory: [hop] }))).toEqual([])
  })
})

// ── low_stock ───────────────────────────────────────────────────────────────

describe('detectLowStock', () => {
  it('fires (warn) at/below the low-stock threshold', () => {
    const item = inv({ name: 'Gypsum', amount: 0.5, lowStockThreshold: 1, amountUnit: 'g' })
    const out = detectLowStock(ctx({ inventory: [item] }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('low_stock')
    expect(out[0].severity).toBe('warn')
    expect(out[0].id).toBe(`low_stock:${item.id}`)
  })

  it('escalates to urgent when 0 on hand', () => {
    const item = inv({ name: 'US-05', amount: 0, lowStockThreshold: 2, amountUnit: 'packets' })
    const out = detectLowStock(ctx({ inventory: [item] }))
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('urgent')
    expect(out[0].title).toContain('Out of')
  })

  it('fires on a par shortfall even without a low-stock threshold', () => {
    const item = inv({ name: 'Base Malt', amount: 3, parLevel: 5, amountUnit: 'kg' })
    const out = detectLowStock(ctx({ inventory: [item] }))
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warn')
  })

  it('stays quiet when stocked above threshold and par', () => {
    const item = inv({ name: 'Base Malt', amount: 10, lowStockThreshold: 2, parLevel: 5 })
    expect(detectLowStock(ctx({ inventory: [item] }))).toEqual([])
  })

  it('stays quiet with neither a threshold nor a par level', () => {
    const item = inv({ name: 'Whirlfloc', amount: 1 })
    expect(detectLowStock(ctx({ inventory: [item] }))).toEqual([])
  })
})

// ── buildInsights: ranking, ids, empties, guards ────────────────────────────

describe('buildInsights', () => {
  it('returns [] for empty inputs', () => {
    expect(buildInsights(ctx({}))).toEqual([])
  })

  it('does not throw when a batch has no readings entry at all', () => {
    const b = batch({ id: 'b1', ...withFG(1.01) })
    expect(() => buildInsights(ctx({ batches: [b] }))).not.toThrow()
    expect(buildInsights(ctx({ batches: [b] }))).toEqual([])
  })

  it('does not throw on an undated / unparseable batch date', () => {
    const b = batch({ id: 'b1', brewedAt: undefined, startedAt: 'not-a-date', ...withFG(1.01) })
    const c = ctx({
      batches: [b],
      readingsByBatch: { b1: [reading('b1', 5, 1.03), reading('b1', 0, 1.03)] },
    })
    expect(() => buildInsights(c)).not.toThrow()
    // stuck can't compute ferment-days -> quiet; nothing else applies either.
    expect(buildInsights(c)).toEqual([])
  })

  it('ranks urgent > warn > info, then newest-signal first', () => {
    const outOfStock = inv({
      name: 'US-05',
      amount: 0,
      lowStockThreshold: 2,
      updatedAt: daysAgo(2),
    }) // urgent
    const lowRecent = inv({
      name: 'Gypsum',
      amount: 0.5,
      lowStockThreshold: 1,
      updatedAt: daysAgo(1),
    }) // warn, newer
    const oldHop = inv({ ingredientKind: 'hop', name: 'Simcoe', purchaseDate: daysAgo(430) }) // warn, older
    const readyBatch = batch({ id: 'b1', ...withFG(1.01) }) // info
    const out = buildInsights(
      ctx({
        batches: [readyBatch],
        readingsByBatch: { b1: [reading('b1', 3, 1.011), reading('b1', 0, 1.01)] },
        inventory: [oldHop, lowRecent, outOfStock],
      }),
    )
    expect(out.map((i) => i.severity)).toEqual(['urgent', 'warn', 'warn', 'info'])
    // within the two warns, the newer signal (updatedAt daysAgo(1)) sorts first
    expect(out[1].kind).toBe('low_stock')
    expect(out[2].kind).toBe('aging_hops')
    expect(out[3].kind).toBe('ready_to_package')
  })

  it('produces stable, deterministic ids + ordering across runs', () => {
    const item = inv({ id: 'itemA', name: 'Gypsum', amount: 0, lowStockThreshold: 1 })
    const c = ctx({ inventory: [item] })
    const a = buildInsights(c)
    const b = buildInsights(c)
    expect(a.map((i) => i.id)).toEqual(['low_stock:itemA'])
    expect(a).toEqual(b)
  })

  it('does not throw and self-ignores when readings carry no gravity', () => {
    const bt = batch({ id: 'b1', startedAt: daysAgo(6), ...withFG(1.01) })
    const c = ctx({
      batches: [bt],
      readingsByBatch: { b1: [reading('b1', 5, undefined), reading('b1', 0, undefined)] },
    })
    expect(() => buildInsights(c)).not.toThrow()
    expect(buildInsights(c)).toEqual([])
  })
})
