import { describe, expect, expectTypeOf, it } from 'vitest'
import { type Kilograms, kilograms, type Liters, liters } from '@/lib/brewing/types/units'

describe('branded unit types', () => {
  it('liters() tags a number as Liters', () => {
    const v = liters(19)
    expect(v).toBe(19)
    expectTypeOf(v).toEqualTypeOf<Liters>()
  })

  it('kilograms() tags a number as Kilograms', () => {
    const v = kilograms(4.5)
    expect(v).toBe(4.5)
    expectTypeOf(v).toEqualTypeOf<Kilograms>()
  })

  it('Liters and Kilograms are not assignable to each other', () => {
    const l: Liters = liters(1)
    // @ts-expect-error — Kilograms not assignable to Liters
    const k: Liters = kilograms(1)
    expect(l).toBe(1)
    expect(k).toBe(1)
  })
})
