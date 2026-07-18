import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapBrewfatherInventoryItem } from '@/lib/brewing/brewfather/map-inventory'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { StockTransactionSchema } from '@/lib/brewing/types/stock-transaction'

const NOW = '2026-07-17T10:00:00.000Z'

function loadFixture(name: string): unknown[] {
  const file = path.join(__dirname, '../../fixtures/brewfather', name)
  return JSON.parse(readFileSync(file, 'utf-8'))
}

describe('mapBrewfatherInventoryItem', () => {
  it('maps a fermentable: kg unit, vendor, best-by date', () => {
    const [pale] = loadFixture('fermentables.json')
    const { item, opening } = mapBrewfatherInventoryItem(pale, 'fermentable', { now: NOW })
    const it_ = InventoryItemSchema.parse(item)
    expect(it_.name).toBe('Pale Ale Malt')
    expect(it_.ingredientKind).toBe('fermentable')
    expect(it_.amount).toBe(12.5)
    expect(it_.amountUnit).toBe('kg')
    expect(it_.vendor).toBe('Great Western')
    expect(it_.bestByDate).toBe(new Date(1767225600000).toISOString())
    expect(opening).not.toBeNull()
  })

  it('price with NO currency maps to USD with a warning', () => {
    const [pale] = loadFixture('fermentables.json')
    const { item, warnings } = mapBrewfatherInventoryItem(pale, 'fermentable', { now: NOW })
    expect(item?.pricePerUnit_USD).toBe(2.1)
    expect(warnings.join('\n')).toMatch(/no currency.*assumed USD/)
  })

  it('price in a non-USD currency is NOT imported (warned)', () => {
    const munich = loadFixture('fermentables.json')[2]
    const { item, warnings } = mapBrewfatherInventoryItem(munich, 'fermentable', { now: NOW })
    expect(item?.pricePerUnit_USD).toBeUndefined()
    expect(warnings.join('\n')).toMatch(/cost in EUR not imported/)
  })

  it('price explicitly in USD maps silently', () => {
    const [citra] = loadFixture('hops.json')
    const { item, warnings } = mapBrewfatherInventoryItem(citra, 'hop', { now: NOW })
    expect(item?.amountUnit).toBe('g')
    expect(item?.amount).toBe(250)
    expect(item?.pricePerUnit_USD).toBe(0.04)
    expect(warnings.filter((w) => /cost|currency|USD/i.test(w))).toHaveLength(0)
  })

  it('maps yeast packages → packets and folds the product id into the name', () => {
    const [london, us05] = loadFixture('yeasts.json')
    const a = mapBrewfatherInventoryItem(london, 'yeast', { now: NOW })
    expect(a.item?.name).toBe('London Ale III (1318)')
    expect(a.item?.amountUnit).toBe('packets')
    expect(a.item?.amount).toBe(2)
    expect(a.item?.vendor).toBe('Wyeast')

    // Name already contains the product id → no duplicate suffix; missing unit
    // defaults to packets with a warning.
    const b = mapBrewfatherInventoryItem(us05, 'yeast', { now: NOW })
    expect(b.item?.name).toBe('Safale US-05')
    expect(b.item?.amountUnit).toBe('packets')
    expect(b.warnings.join('\n')).toMatch(/defaulted to packets/)
  })

  it('maps misc "items" → each and keeps g as-is', () => {
    const [whirlfloc, cacl] = loadFixture('miscs.json')
    expect(mapBrewfatherInventoryItem(whirlfloc, 'misc', { now: NOW }).item?.amountUnit).toBe(
      'each',
    )
    expect(mapBrewfatherInventoryItem(cacl, 'misc', { now: NOW }).item?.amountUnit).toBe('g')
  })

  it('skips a misc whose unit has no app equivalent (tsp), with a warning', () => {
    const vanilla = loadFixture('miscs.json')[2]
    const { item, opening, warnings } = mapBrewfatherInventoryItem(vanilla, 'misc', { now: NOW })
    expect(item).toBeNull()
    expect(opening).toBeNull()
    expect(warnings.join('\n')).toMatch(/unit "tsp" has no app equivalent/)
  })

  it('emits an opening ledger txn with delta === amount (doctor C1 invariant)', () => {
    const [pale] = loadFixture('fermentables.json')
    const { item, opening } = mapBrewfatherInventoryItem(pale, 'fermentable', { now: NOW })
    const txn = StockTransactionSchema.parse(opening)
    expect(txn.inventoryItemId).toBe(item?.id)
    expect(txn.delta).toBe(item?.amount)
    expect(txn.unit).toBe(item?.amountUnit)
    expect(txn.reason).toBe('opening')
    expect(txn.at).toBe(NOW)
  })

  it('zero stock still gets its opening txn (delta 0)', () => {
    const saaz = loadFixture('hops.json')[1]
    const { item, opening } = mapBrewfatherInventoryItem(saaz, 'hop', { now: NOW })
    expect(item?.amount).toBe(0)
    expect(opening?.delta).toBe(0)
  })

  it('missing amount defaults to 0 with a warning; negative clamps to 0', () => {
    const a = mapBrewfatherInventoryItem({ _id: 'x', name: 'NoAmount' }, 'hop', { now: NOW })
    expect(a.item?.amount).toBe(0)
    expect(a.warnings.join('\n')).toMatch(/amount missing/)

    const b = mapBrewfatherInventoryItem({ _id: 'y', name: 'Negative', inventory: -3 }, 'hop', {
      now: NOW,
    })
    expect(b.item?.amount).toBe(0)
    expect(b.warnings.join('\n')).toMatch(/clamped to 0/)
  })

  it('derives stable ids per kind (idempotent re-import)', () => {
    const [pale] = loadFixture('fermentables.json')
    const a = mapBrewfatherInventoryItem(pale, 'fermentable', { now: NOW })
    const b = mapBrewfatherInventoryItem(pale, 'fermentable', {
      now: '2027-01-01T00:00:00.000Z',
    })
    expect(a.item?.id).toBe(b.item?.id)
    expect(a.opening?.id).toBe(b.opening?.id)
  })

  it('skips an item with no name', () => {
    const { item, warnings } = mapBrewfatherInventoryItem({ inventory: 5 }, 'hop', { now: NOW })
    expect(item).toBeNull()
    expect(warnings.join('\n')).toMatch(/no name/)
  })
})
