import { describe, expect, it } from 'vitest'
import { convertAmount, dimensionOf } from '@/lib/brewing/convert/units'

describe('dimensionOf', () => {
  it('classifies mass units', () => {
    for (const u of ['g', 'kg', 'oz', 'lb']) expect(dimensionOf(u)).toBe('mass')
  })
  it('classifies volume units', () => {
    for (const u of ['ml', 'L']) expect(dimensionOf(u)).toBe('volume')
  })
  it('classifies count units', () => {
    expect(dimensionOf('each')).toBe('count')
    expect(dimensionOf('packets')).toBe('count')
  })
  it('returns null for tsp/tbsp (density-dependent, not an inventory unit)', () => {
    expect(dimensionOf('tsp')).toBeNull()
    expect(dimensionOf('tbsp')).toBeNull()
  })
  it('returns null for unknown units', () => {
    expect(dimensionOf('furlong')).toBeNull()
  })
})

describe('convertAmount — within dimension', () => {
  it('identity when units match', () => {
    expect(convertAmount(5, 'kg', 'kg')).toBe(5)
    expect(convertAmount(12, 'g', 'g')).toBe(12)
  })
  it('kg ↔ g', () => {
    expect(convertAmount(5, 'kg', 'g')).toBe(5000)
    expect(convertAmount(2500, 'g', 'kg')).toBe(2.5)
  })
  it('oz → g and lb → g', () => {
    expect(convertAmount(1, 'oz', 'g')).toBeCloseTo(28.3495, 3)
    expect(convertAmount(1, 'lb', 'g')).toBeCloseTo(453.59237, 3)
  })
  it('g → oz round-trips', () => {
    expect(convertAmount(28.349523125, 'g', 'oz')).toBeCloseTo(1, 6)
  })
  it('lb → kg', () => {
    expect(convertAmount(1, 'lb', 'kg')).toBeCloseTo(0.453592, 5)
  })
  it('L ↔ ml', () => {
    expect(convertAmount(1, 'L', 'ml')).toBe(1000)
    expect(convertAmount(500, 'ml', 'L')).toBe(0.5)
  })
  it('count is 1:1 (each ↔ packets)', () => {
    expect(convertAmount(3, 'each', 'packets')).toBe(3)
    expect(convertAmount(2, 'packets', 'each')).toBe(2)
  })
})

describe('convertAmount — cross dimension → null (never guess)', () => {
  it('mass ↔ volume', () => {
    expect(convertAmount(1, 'g', 'ml')).toBeNull()
    expect(convertAmount(1, 'ml', 'g')).toBeNull()
  })
  it('count ↔ mass', () => {
    expect(convertAmount(1, 'each', 'g')).toBeNull()
    expect(convertAmount(1, 'kg', 'packets')).toBeNull()
  })
  it('count ↔ volume', () => {
    expect(convertAmount(1, 'each', 'ml')).toBeNull()
  })
  it('tsp/tbsp are unconvertible in either direction', () => {
    expect(convertAmount(2, 'tsp', 'g')).toBeNull()
    expect(convertAmount(2, 'tbsp', 'ml')).toBeNull()
    expect(convertAmount(2, 'g', 'tsp')).toBeNull()
  })
})
