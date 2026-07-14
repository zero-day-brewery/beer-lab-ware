import { describe, expect, it } from 'vitest'
import {
  GEAR_CATEGORY_LABELS,
  GEAR_CATEGORY_ORDER,
  groupGearByCategory,
} from '@/lib/brewing/gear/group-by-category'
import type { GearCategory, GearItem } from '@/lib/brewing/types/gear'

let seq = 0
function gear(p: Partial<GearItem> & { name: string; category: GearCategory }): GearItem {
  seq += 1
  return {
    id: `550e8400-e29b-41d4-a716-4466554400${String(seq).padStart(2, '0')}`,
    condition: 'good',
    notes_md: '',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    schemaVersion: 1,
    ...p,
  }
}

describe('groupGearByCategory', () => {
  it('returns [] for an empty list', () => {
    expect(groupGearByCategory([])).toEqual([])
  })

  it('groups items by category with per-group count and summed value', () => {
    const groups = groupGearByCategory([
      gear({ name: 'Keg A', category: 'kegging', pricePaid_USD: 100 }),
      gear({ name: 'Keg B', category: 'kegging', pricePaid_USD: 50 }),
      gear({ name: 'Hydrometer', category: 'instrument', pricePaid_USD: 20 }),
    ])
    expect(groups).toHaveLength(2)
    const kegging = groups.find((g) => g.category === 'kegging')
    expect(kegging?.count).toBe(2)
    expect(kegging?.totalValue).toBe(150)
    expect(kegging?.label).toBe('Kegging')
    const instrument = groups.find((g) => g.category === 'instrument')
    expect(instrument?.count).toBe(1)
    expect(instrument?.totalValue).toBe(20)
  })

  it('treats an undefined price as 0 in totalValue', () => {
    const [group] = groupGearByCategory([
      gear({ name: 'Priced', category: 'storage', pricePaid_USD: 40 }),
      gear({ name: 'Unpriced', category: 'storage' }),
    ])
    expect(group.count).toBe(2)
    expect(group.totalValue).toBe(40)
  })

  it('orders groups by the schema declaration order regardless of input order', () => {
    const groups = groupGearByCategory([
      gear({ name: 'Bin', category: 'storage' }),
      gear({ name: 'Keg', category: 'kegging' }),
      gear({ name: 'Thermometer', category: 'instrument' }),
    ])
    // schema order: … instrument < kegging < storage
    expect(groups.map((g) => g.category)).toEqual(['instrument', 'kegging', 'storage'])
  })

  it('omits categories that have no items (no empty sections)', () => {
    const groups = groupGearByCategory([gear({ name: 'Kettle', category: 'kettle' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe('kettle')
  })

  it('preserves input order of items within a group', () => {
    const [group] = groupGearByCategory([
      gear({ name: 'First', category: 'cleaning' }),
      gear({ name: 'Second', category: 'cleaning' }),
      gear({ name: 'Third', category: 'cleaning' }),
    ])
    expect(group.items.map((i) => i.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('labels every category and exposes the canonical order', () => {
    expect(GEAR_CATEGORY_ORDER[GEAR_CATEGORY_ORDER.length - 1]).toBe('other')
    for (const cat of GEAR_CATEGORY_ORDER) {
      expect(GEAR_CATEGORY_LABELS[cat]).toBeTruthy()
    }
  })
})
