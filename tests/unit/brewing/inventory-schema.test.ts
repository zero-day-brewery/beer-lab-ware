import { describe, expect, it } from 'vitest'
import {
  type InventoryItem,
  InventoryItemSchema,
  isLowStock,
  isPastBestBy,
} from '@/lib/brewing/types/inventory'

const valid: InventoryItem = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  name: 'Cascade pellets 2024',
  ingredientKind: 'hop',
  amount: 227,
  amountUnit: 'g',
  lowStockThreshold: 56,
  vendor: 'Yakima Valley Hops',
  purchaseDate: '2024-09-01T00:00:00.000Z',
  bestByDate: '2026-09-01T00:00:00.000Z',
  pricePerUnit_USD: 0.05,
  storageLocation: 'Freezer #2',
  status: 'sealed',
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('InventoryItemSchema', () => {
  it('accepts a valid inventory item', () => {
    expect(() => InventoryItemSchema.parse(valid)).not.toThrow()
  })

  it('requires name', () => {
    expect(() => InventoryItemSchema.parse({ ...valid, name: '' })).toThrow()
  })

  it('rejects unknown ingredientKind', () => {
    expect(() =>
      InventoryItemSchema.parse({ ...valid, ingredientKind: 'unicorn' as 'hop' }),
    ).toThrow()
  })

  it('rejects unknown amountUnit', () => {
    expect(() => InventoryItemSchema.parse({ ...valid, amountUnit: 'parsecs' as 'g' })).toThrow()
  })

  it('rejects negative amount', () => {
    expect(() => InventoryItemSchema.parse({ ...valid, amount: -1 })).toThrow()
  })

  it('rejects unknown status', () => {
    expect(() =>
      InventoryItemSchema.parse({ ...valid, status: 'half-opened' as 'sealed' }),
    ).toThrow()
  })

  it('accepts the additive openedDate + parLevel fields', () => {
    const parsed = InventoryItemSchema.parse({
      ...valid,
      openedDate: '2026-06-01T00:00:00.000Z',
      parLevel: 100,
    })
    expect(parsed.openedDate).toBe('2026-06-01T00:00:00.000Z')
    expect(parsed.parLevel).toBe(100)
    expect(parsed.schemaVersion).toBe(1)
  })

  it('parses a legacy row (no openedDate / parLevel) unchanged', () => {
    const parsed = InventoryItemSchema.parse(valid)
    expect(parsed.openedDate).toBeUndefined()
    expect(parsed.parLevel).toBeUndefined()
  })

  it('rejects a negative parLevel', () => {
    expect(() => InventoryItemSchema.parse({ ...valid, parLevel: -5 })).toThrow()
  })
})

describe('isLowStock', () => {
  it('returns false when no threshold set', () => {
    const item: InventoryItem = { ...valid, lowStockThreshold: undefined, amount: 10 }
    expect(isLowStock(item)).toBe(false)
  })

  it('returns true when amount is below threshold', () => {
    const item: InventoryItem = { ...valid, lowStockThreshold: 100, amount: 50 }
    expect(isLowStock(item)).toBe(true)
  })

  it('returns true when amount equals threshold (boundary)', () => {
    const item: InventoryItem = { ...valid, lowStockThreshold: 50, amount: 50 }
    expect(isLowStock(item)).toBe(true)
  })

  it('returns false when amount is above threshold', () => {
    const item: InventoryItem = { ...valid, lowStockThreshold: 50, amount: 100 }
    expect(isLowStock(item)).toBe(false)
  })
})

describe('isPastBestBy', () => {
  it('returns false when no best-by set', () => {
    const item: InventoryItem = { ...valid, bestByDate: undefined }
    expect(isPastBestBy(item)).toBe(false)
  })

  it('returns true when best-by is in the past', () => {
    const item: InventoryItem = { ...valid, bestByDate: '2020-01-01T00:00:00.000Z' }
    expect(isPastBestBy(item, new Date('2026-05-12'))).toBe(true)
  })

  it('returns false when best-by is in the future', () => {
    const item: InventoryItem = { ...valid, bestByDate: '2030-01-01T00:00:00.000Z' }
    expect(isPastBestBy(item, new Date('2026-05-12'))).toBe(false)
  })
})
