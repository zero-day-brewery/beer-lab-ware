import { describe, expect, it } from 'vitest'
import { formatGravity } from '@/lib/format/gravity'

describe('formatGravity', () => {
  it('formats sg with 3 decimals', () => {
    expect(formatGravity(1.048, 'sg')).toBe('1.048')
  })
  it('defaults to sg', () => {
    expect(formatGravity(1.012)).toBe('1.012')
  })
  it('formats plato with the SG in parens', () => {
    expect(formatGravity(1.048, 'plato')).toBe('11.9 °P (1.048)')
  })
})
