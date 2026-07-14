import { describe, expect, it } from 'vitest'
import {
  GEAR_COLUMNS,
  INGREDIENT_COLUMNS,
  type ReportColumn,
  type ReportContext,
} from '@/lib/brewing/report/columns'
import type { GearItem } from '@/lib/brewing/types/gear'
import type { InventoryItem } from '@/lib/brewing/types/inventory'

const CTX: ReportContext = { generatedAt: new Date('2026-06-05T12:00:00.000Z') }

function cell<T>(columns: ReportColumn<T>[], header: string, item: T): string {
  const col = columns.find((c) => c.header === header)
  if (!col) throw new Error(`No column with header: ${header}`)
  return col.get(item, CTX)
}

const baseGear: GearItem = {
  id: 'g1',
  name: 'B40 Pro',
  category: 'mash-tun',
  brand: 'BrewTools',
  purchaseDate: '2025-03-01T00:00:00.000Z',
  pricePaid_USD: 1234.5,
  condition: 'good',
  notes_md: 'flagship',
  createdAt: CTX.generatedAt.toISOString(),
  updatedAt: CTX.generatedAt.toISOString(),
  schemaVersion: 1,
}

const baseInv: InventoryItem = {
  id: 'i1',
  name: 'Cascade',
  ingredientKind: 'hop',
  amount: 1,
  amountUnit: 'kg',
  lowStockThreshold: 2,
  status: 'sealed',
  notes_md: '',
  createdAt: CTX.generatedAt.toISOString(),
  updatedAt: CTX.generatedAt.toISOString(),
  schemaVersion: 1,
}

describe('report columns', () => {
  it('formats gear fields', () => {
    const row = (h: string) => cell(GEAR_COLUMNS, h, baseGear)
    expect(row('Name')).toBe('B40 Pro')
    expect(row('Category')).toBe('Mash Tun')
    expect(row('Purchase Date')).toBe('2025-03-01')
    expect(row('Price Paid (USD)')).toBe('$1234.50')
    expect(row('Model')).toBe('')
  })

  it('formats ingredient fields incl. low-stock flag and enum label', () => {
    const row = (h: string) => cell(INGREDIENT_COLUMNS, h, baseInv)
    expect(row('Name')).toBe('Cascade')
    expect(row('Kind')).toBe('Hops')
    expect(row('Amount')).toBe('1')
    expect(row('Unit')).toBe('kg')
    expect(row('Low Stock')).toBe('LOW')
    expect(row('Best-By')).toBe('')
  })
})
