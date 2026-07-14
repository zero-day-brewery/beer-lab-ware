import { describe, expect, it } from 'vitest'
import { calcInfusionWater } from '@/lib/brewing/mash/infusion'
import { calcStepInfusions } from '@/lib/brewing/mash/step-infusions'
import type { Recipe } from '@/lib/brewing/types/recipe'

const ID = '550e8400-e29b-41d4-a716-446655440000'
function recipeWithSteps(steps: Recipe['mashSteps']): Recipe {
  return {
    id: ID,
    name: 'M',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: ID,
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: steps,
    notes_md: '',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    schemaVersion: 1,
  }
}

describe('calcStepInfusions', () => {
  it('returns null for the strike step (index 0)', () => {
    const r = recipeWithSteps([
      { name: 'Sacch', type: 'infusion', temperature_C: 66, time_min: 60 },
    ])
    const out = calcStepInfusions(r, { strikeVolume_L: 13, grainMass_kg: 4 })
    expect(out).toHaveLength(1)
    expect(out[0].water_L).toBeNull()
  })

  it('computes positive infusion water for a rising infusion step', () => {
    const r = recipeWithSteps([
      { name: 'Sacch', type: 'infusion', temperature_C: 66, time_min: 45 },
      { name: 'Mashout', type: 'infusion', temperature_C: 72, time_min: 10 },
    ])
    const out = calcStepInfusions(r, { strikeVolume_L: 13, grainMass_kg: 4 })
    const expected = calcInfusionWater({
      grainMass_kg: 4,
      currentMashVolume_L: 13,
      currentTemp_C: 66,
      targetTemp_C: 72,
      infusionWaterTemp_C: 100,
    })
    expect(out[1].water_L).toBeCloseTo(expected)
    expect(out[1].water_L as number).toBeGreaterThan(0)
  })

  it('returns null for temperature/decoction steps', () => {
    const r = recipeWithSteps([
      { name: 'Sacch', type: 'infusion', temperature_C: 66, time_min: 45 },
      { name: 'Mashout', type: 'temperature', temperature_C: 72, time_min: 10 },
    ])
    const out = calcStepInfusions(r, { strikeVolume_L: 13, grainMass_kg: 4 })
    expect(out[1].water_L).toBeNull()
  })

  it('accumulates running mash volume across multiple infusions', () => {
    const r = recipeWithSteps([
      { name: 'A', type: 'infusion', temperature_C: 50, time_min: 20 },
      { name: 'B', type: 'infusion', temperature_C: 62, time_min: 30 },
      { name: 'C', type: 'infusion', temperature_C: 72, time_min: 10 },
    ])
    const out = calcStepInfusions(r, { strikeVolume_L: 12, grainMass_kg: 4 })
    const first = calcInfusionWater({
      grainMass_kg: 4,
      currentMashVolume_L: 12,
      currentTemp_C: 50,
      targetTemp_C: 62,
      infusionWaterTemp_C: 100,
    })
    const second = calcInfusionWater({
      grainMass_kg: 4,
      currentMashVolume_L: 12 + first,
      currentTemp_C: 62,
      targetTemp_C: 72,
      infusionWaterTemp_C: 100,
    })
    expect(out[1].water_L).toBeCloseTo(first)
    expect(out[2].water_L).toBeCloseTo(second)
  })
})
