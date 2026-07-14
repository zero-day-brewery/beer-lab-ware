import { describe, expect, it } from 'vitest'
import { calcStrikeTemp } from '@/lib/brewing/mash/strike'

describe('calcStrikeTemp', () => {
  it('66°C target, 20°C grain, 2.6 L/kg ratio → ~73°C strike', () => {
    // T = (0.41/2.6) × (66-20) + 66 = 0.1577 × 46 + 66 = 73.25
    expect(calcStrikeTemp(66, 20, 2.6)).toBeCloseTo(73.25, 0)
  })

  it('higher grain temp → lower required strike temp', () => {
    expect(calcStrikeTemp(66, 10, 2.6)).toBeGreaterThan(calcStrikeTemp(66, 25, 2.6))
  })

  it('strike temp is always higher than target temp', () => {
    expect(calcStrikeTemp(66, 20, 2.6)).toBeGreaterThan(66)
    expect(calcStrikeTemp(70, 20, 3.0)).toBeGreaterThan(70)
  })
})
