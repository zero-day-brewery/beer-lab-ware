import { describe, expect, it } from 'vitest'
import { type GearItem, GearItemSchema } from '@/lib/brewing/types/gear'

const valid: GearItem = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: '10gal Stainless Kettle',
  category: 'kettle',
  brand: 'Anvil',
  model: 'Foundry 10.5',
  serialNumber: 'AB12345',
  purchaseDate: '2024-03-15T00:00:00.000Z',
  pricePaid_USD: 449.99,
  vendor: 'Homebrew Supply Co',
  location: 'Garage shelf 2',
  condition: 'good',
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('GearItemSchema', () => {
  it('accepts a valid gear item', () => {
    expect(() => GearItemSchema.parse(valid)).not.toThrow()
  })

  it('requires name', () => {
    expect(() => GearItemSchema.parse({ ...valid, name: '' })).toThrow()
  })

  it('rejects unknown category', () => {
    expect(() => GearItemSchema.parse({ ...valid, category: 'spaceship' as 'kettle' })).toThrow()
  })

  it('rejects unknown condition', () => {
    expect(() => GearItemSchema.parse({ ...valid, condition: 'fabulous' as 'new' })).toThrow()
  })

  it('rejects negative price', () => {
    expect(() => GearItemSchema.parse({ ...valid, pricePaid_USD: -10 })).toThrow()
  })

  it('accepts items with no optional fields', () => {
    const minimal: GearItem = {
      id: '550e8400-e29b-41d4-a716-446655440011',
      name: 'Generic kettle',
      category: 'other',
      condition: 'good',
      notes_md: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
      schemaVersion: 1,
    }
    expect(() => GearItemSchema.parse(minimal)).not.toThrow()
  })
})
