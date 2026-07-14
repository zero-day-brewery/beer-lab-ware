import { describe, expect, it } from 'vitest'
import {
  buildInventoryStats,
  hopAge,
  itemFreshness,
  itemValue,
  yeastViability,
} from '@/lib/brewing/inventory/freshness'
import type { InventoryItem } from '@/lib/brewing/types/inventory'

const NOW = new Date('2026-07-05T12:00:00.000Z')
const DAY = 86_400_000

const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString()

function inv(p: Partial<InventoryItem>): InventoryItem {
  return {
    id: crypto.randomUUID(),
    name: 'Ing',
    ingredientKind: 'other',
    amount: 1,
    amountUnit: 'each',
    status: 'sealed',
    notes_md: '',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...p,
  }
}

describe('itemValue', () => {
  it('multiplies amount by price', () => {
    expect(itemValue(inv({ amount: 10, pricePerUnit_USD: 2 }))).toBe(20)
  })
  it('treats a missing price as 0', () => {
    expect(itemValue(inv({ amount: 10, pricePerUnit_USD: undefined }))).toBe(0)
  })
})

describe('itemFreshness', () => {
  it('is fresh with no dates', () => {
    expect(itemFreshness(inv({}), NOW).state).toBe('fresh')
  })
  it('is expired past best-by', () => {
    const f = itemFreshness(inv({ bestByDate: daysAgo(1) }), NOW)
    expect(f.state).toBe('expired')
    expect(f.reason).toBeDefined()
  })
  it('is aging exactly 30 days before best-by (boundary)', () => {
    expect(itemFreshness(inv({ bestByDate: daysAhead(30) }), NOW).state).toBe('aging')
  })
  it('is fresh 31 days before best-by', () => {
    expect(itemFreshness(inv({ bestByDate: daysAhead(31) }), NOW).state).toBe('fresh')
  })
  it('is aging when opened more than 60 days ago', () => {
    const f = itemFreshness(inv({ status: 'opened', openedDate: daysAgo(61) }), NOW)
    expect(f.state).toBe('aging')
  })
  it('is fresh at exactly 60 days opened (boundary, not > 60)', () => {
    expect(itemFreshness(inv({ status: 'opened', openedDate: daysAgo(60) }), NOW).state).toBe(
      'fresh',
    )
  })
  it('ignores openedDate when the item is still sealed', () => {
    expect(itemFreshness(inv({ status: 'sealed', openedDate: daysAgo(90) }), NOW).state).toBe(
      'fresh',
    )
  })
  it('prefers expired over opened-aging', () => {
    expect(
      itemFreshness(inv({ bestByDate: daysAgo(1), status: 'opened', openedDate: daysAgo(90) }), NOW)
        .state,
    ).toBe('expired')
  })
})

describe('yeastViability', () => {
  it('is null for non-yeast', () => {
    expect(
      yeastViability(inv({ ingredientKind: 'hop', purchaseDate: daysAgo(10) }), NOW),
    ).toBeNull()
  })
  it('is null for yeast without a purchase date', () => {
    expect(yeastViability(inv({ ingredientKind: 'yeast' }), NOW)).toBeNull()
  })
  it('decreases with age', () => {
    const young = yeastViability(inv({ ingredientKind: 'yeast', purchaseDate: daysAgo(10) }), NOW)
    const old = yeastViability(inv({ ingredientKind: 'yeast', purchaseDate: daysAgo(100) }), NOW)
    expect(young).not.toBeNull()
    expect(old).not.toBeNull()
    expect(young as number).toBeGreaterThan(old as number)
  })
  it('clamps to 0 for very old yeast', () => {
    expect(yeastViability(inv({ ingredientKind: 'yeast', purchaseDate: daysAgo(1000) }), NOW)).toBe(
      0,
    )
  })
  it('clamps to 100 (never exceeds) for a future purchase date', () => {
    const v = yeastViability(inv({ ingredientKind: 'yeast', purchaseDate: daysAhead(100) }), NOW)
    expect(v).toBeLessThanOrEqual(100)
    expect(v).toBe(100)
  })
  it('starts near 97% at time of purchase', () => {
    const v = yeastViability(inv({ ingredientKind: 'yeast', purchaseDate: NOW.toISOString() }), NOW)
    expect(v).toBeCloseTo(97, 5)
  })
})

describe('hopAge', () => {
  it('is null for non-hop and for hop without a date', () => {
    expect(hopAge(inv({ ingredientKind: 'yeast', purchaseDate: daysAgo(10) }), NOW)).toBeNull()
    expect(hopAge(inv({ ingredientKind: 'hop' }), NOW)).toBeNull()
  })
  it('is fresh under 6 months', () => {
    expect(hopAge(inv({ ingredientKind: 'hop', purchaseDate: daysAgo(30) }), NOW)?.state).toBe(
      'fresh',
    )
  })
  it('is aging between 6 and 12 months', () => {
    expect(hopAge(inv({ ingredientKind: 'hop', purchaseDate: daysAgo(200) }), NOW)?.state).toBe(
      'aging',
    )
  })
  it('is old past 12 months', () => {
    expect(hopAge(inv({ ingredientKind: 'hop', purchaseDate: daysAgo(400) }), NOW)?.state).toBe(
      'old',
    )
  })
  it('reports a positive month count', () => {
    const age = hopAge(inv({ ingredientKind: 'hop', purchaseDate: daysAgo(200) }), NOW)
    expect(age?.months).toBeGreaterThan(6)
    expect(age?.months).toBeLessThan(7)
  })
})

describe('buildInventoryStats', () => {
  it('handles the empty case', () => {
    const s = buildInventoryStats([], NOW)
    expect(s).toEqual({
      itemCount: 0,
      totalValue_USD: 0,
      lowStockCount: 0,
      expiringSoonCount: 0,
      shopping: [],
    })
  })

  it('rolls up total value across items', () => {
    const s = buildInventoryStats(
      [
        inv({ amount: 10, pricePerUnit_USD: 2 }), // 20
        inv({ amount: 5, pricePerUnit_USD: undefined }), // 0
        inv({ amount: 4, pricePerUnit_USD: 0.5 }), // 2
      ],
      NOW,
    )
    expect(s.totalValue_USD).toBe(22)
    expect(s.itemCount).toBe(3)
  })

  it('counts low-stock items', () => {
    const s = buildInventoryStats(
      [
        inv({ amount: 20, lowStockThreshold: 50 }), // low
        inv({ amount: 80, lowStockThreshold: 50 }), // ok
        inv({ amount: 5 }), // no threshold → not low
      ],
      NOW,
    )
    expect(s.lowStockCount).toBe(1)
  })

  it('counts expiring-soon (aging or expired) items', () => {
    const s = buildInventoryStats(
      [
        inv({ bestByDate: daysAgo(1) }), // expired
        inv({ bestByDate: daysAhead(10) }), // aging
        inv({ bestByDate: daysAhead(120) }), // fresh
        inv({}), // fresh
      ],
      NOW,
    )
    expect(s.expiringSoonCount).toBe(2)
  })

  it('builds shopping lines from par level with deficit + est cost', () => {
    const s = buildInventoryStats(
      [inv({ name: 'Cascade', amount: 30, parLevel: 100, pricePerUnit_USD: 0.5 })],
      NOW,
    )
    expect(s.shopping).toHaveLength(1)
    expect(s.shopping[0].deficit).toBe(70)
    expect(s.shopping[0].estCost).toBe(35)
    expect(s.shopping[0].item.name).toBe('Cascade')
  })

  it('falls back to lowStockThreshold when no par level', () => {
    const s = buildInventoryStats([inv({ amount: 20, lowStockThreshold: 50 })], NOW)
    expect(s.shopping).toHaveLength(1)
    expect(s.shopping[0].deficit).toBe(30)
  })

  it('prefers par level over lowStockThreshold', () => {
    const s = buildInventoryStats([inv({ amount: 40, parLevel: 100, lowStockThreshold: 50 })], NOW)
    expect(s.shopping[0].deficit).toBe(60)
  })

  it('excludes items at or above target from the shopping list', () => {
    const s = buildInventoryStats(
      [inv({ amount: 100, parLevel: 100 }), inv({ amount: 10 /* no target */ })],
      NOW,
    )
    expect(s.shopping).toHaveLength(0)
  })
})
