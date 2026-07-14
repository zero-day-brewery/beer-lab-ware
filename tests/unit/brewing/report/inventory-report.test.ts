import { describe, expect, it } from 'vitest'
import { buildInventoryReport } from '@/lib/brewing/report/inventory-report'
import type { GearItem } from '@/lib/brewing/types/gear'
import type { InventoryItem } from '@/lib/brewing/types/inventory'

const NOW = new Date('2026-06-05T12:00:00.000Z')

function gear(p: Partial<GearItem>): GearItem {
  return {
    id: crypto.randomUUID(),
    name: 'Item',
    category: 'other',
    condition: 'good',
    notes_md: '',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...p,
  }
}

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

describe('buildInventoryReport', () => {
  it('groups gear by category in canonical order, items A→Z', () => {
    const report = buildInventoryReport({
      gear: [
        gear({ name: 'Zeta', category: 'fermenter' }),
        gear({ name: 'Alpha', category: 'fermenter' }),
        gear({ name: 'Kettle1', category: 'kettle' }),
      ],
      inventory: [],
      generatedAt: NOW,
    })
    expect(report.gear.groups.map((g) => g.key)).toEqual(['kettle', 'fermenter'])
    const ferm = report.gear.groups.find((g) => g.key === 'fermenter')
    if (!ferm) throw new Error('fermenter group missing')
    expect(ferm.items.map((i) => i.name)).toEqual(['Alpha', 'Zeta'])
    expect(ferm.count).toBe(2)
    expect(report.gear.totalCount).toBe(3)
  })

  it('counts low-stock and past-best-by ingredients', () => {
    const report = buildInventoryReport({
      gear: [],
      inventory: [
        inv({ name: 'Lo', amount: 1, lowStockThreshold: 2 }),
        inv({ name: 'Ok', amount: 9, lowStockThreshold: 2 }),
        inv({ name: 'Old', bestByDate: '2020-01-01T00:00:00.000Z' }),
      ],
      generatedAt: NOW,
    })
    expect(report.ingredients.totalCount).toBe(3)
    expect(report.ingredients.lowStockCount).toBe(1)
    expect(report.ingredients.pastBestByCount).toBe(1)
  })

  it('omits empty groups and handles empty inputs', () => {
    const report = buildInventoryReport({ gear: [], inventory: [], generatedAt: NOW })
    expect(report.gear.groups).toEqual([])
    expect(report.gear.totalCount).toBe(0)
    expect(report.ingredients.groups).toEqual([])
    expect(report.generatedAtISO).toBe(NOW.toISOString())
    expect(report.title).toBe('Beer-Lab-Ware')
  })
})
