import { describe, expect, it } from 'vitest'

import { isInStock, YeastLotSchema } from '@/lib/brewing/types/yeast-lot'

const valid = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  name: 'WLP001 California Ale',
  strain: 'California Ale',
  labId: 'WLP001',
  form: 'liquid' as const,
  productionDate: '2026-05-01T00:00:00.000Z',
  initialCells_B: 100,
  generation: 0,
  quantity: 1,
  unit: 'vial' as const,
  source: 'Homebrew Supply Co',
  notes_md: '',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  schemaVersion: 1 as const,
}

describe('YeastLotSchema', () => {
  it('parses a valid lot round-trip', () => {
    expect(YeastLotSchema.parse(valid)).toEqual(valid)
  })

  it('defaults generation and notes_md when omitted', () => {
    const { generation, notes_md, ...rest } = valid
    const parsed = YeastLotSchema.parse(rest)
    expect(parsed.generation).toBe(0)
    expect(parsed.notes_md).toBe('')
  })

  it('rejects non-positive initial cells', () => {
    expect(() => YeastLotSchema.parse({ ...valid, initialCells_B: 0 })).toThrow()
  })

  it('rejects an unknown form', () => {
    expect(() => YeastLotSchema.parse({ ...valid, form: 'powder' })).toThrow()
  })

  it('isInStock reflects quantity', () => {
    expect(isInStock(valid)).toBe(true)
    expect(isInStock({ ...valid, quantity: 0 })).toBe(false)
  })
})
