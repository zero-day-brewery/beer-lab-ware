import { describe, expect, it } from 'vitest'
import { calcVolumes } from '@/lib/brewing/calc/volumes'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
  isDefault: true,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 1.0,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.2,
  evaporationRate_LperHr: 3.0,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.04,
  mashEfficiency_pct: 80,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1.0,
  calibrationNotes_md: '',
  schemaVersion: 1,
}

const smashRecipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: b40.id,
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('calcVolumes', () => {
  it('produces all five volume fields', () => {
    const v = calcVolumes(smashRecipe, b40)
    expect(v).toHaveProperty('mashWater_L')
    expect(v).toHaveProperty('spargeWater_L')
    expect(v).toHaveProperty('preBoilVolume_L')
    expect(v).toHaveProperty('postBoilVolume_L')
    expect(v).toHaveProperty('intoFermenter_L')
  })

  it('into-fermenter volume equals batch size target', () => {
    const v = calcVolumes(smashRecipe, b40)
    expect(v.intoFermenter_L).toBeCloseTo(19, 1)
  })

  it('post-boil > into-fermenter (kettle dead space + cooling shrinkage)', () => {
    const v = calcVolumes(smashRecipe, b40)
    expect(v.postBoilVolume_L).toBeGreaterThan(v.intoFermenter_L)
  })

  it('pre-boil > post-boil by evaporated amount (3L over 60min)', () => {
    const v = calcVolumes(smashRecipe, b40)
    expect(v.preBoilVolume_L - v.postBoilVolume_L).toBeCloseTo(3.0, 1)
  })

  it('mash water + sparge − grain absorption = pre-boil + mash tun dead space', () => {
    const v = calcVolumes(smashRecipe, b40)
    const grainAbsorbed = 4.5 * b40.grainAbsorption_LperKg
    expect(v.mashWater_L + v.spargeWater_L - grainAbsorbed).toBeCloseTo(
      v.preBoilVolume_L + b40.mashTunDeadSpace_L,
      1,
    )
  })

  it('mash water uses default 2.6 L/kg ratio', () => {
    const v = calcVolumes(smashRecipe, b40)
    expect(v.mashWater_L).toBeCloseTo(11.7, 1)
  })
})
