import { describe, expect, it } from 'vitest'
import { calcInfusionWater } from '@/lib/brewing/mash/infusion'
import { defaultMashRatio_LperKg } from '@/lib/brewing/mash/ratio'

describe('default mash ratio', () => {
  it('exports 2.6 L/kg as default', () => {
    expect(defaultMashRatio_LperKg).toBeCloseTo(2.6, 1)
  })
})

describe('calcInfusionWater', () => {
  it('water needed to bump 4.5kg/11.7L mash from 60 to 70 with boiling water', () => {
    // W = 10 × (0.41 × 4.5 + 11.7) / (100 - 70) = 10 × 13.545 / 30 = 4.515
    const w = calcInfusionWater({
      grainMass_kg: 4.5,
      currentMashVolume_L: 11.7,
      currentTemp_C: 60,
      targetTemp_C: 70,
      infusionWaterTemp_C: 100,
    })
    expect(w).toBeCloseTo(4.515, 1)
  })

  it('returns 0 when already at target', () => {
    expect(
      calcInfusionWater({
        grainMass_kg: 4.5,
        currentMashVolume_L: 11.7,
        currentTemp_C: 70,
        targetTemp_C: 70,
        infusionWaterTemp_C: 100,
      }),
    ).toBe(0)
  })

  it('returns 0 when target is below current', () => {
    expect(
      calcInfusionWater({
        grainMass_kg: 4.5,
        currentMashVolume_L: 11.7,
        currentTemp_C: 70,
        targetTemp_C: 65,
        infusionWaterTemp_C: 100,
      }),
    ).toBe(0)
  })
})
