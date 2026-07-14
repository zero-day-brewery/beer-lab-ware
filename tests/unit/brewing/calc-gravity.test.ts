import { describe, expect, it } from 'vitest'
import { calcOG } from '@/lib/brewing/calc/gravity'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40',
  isDefault: true,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 1,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.2,
  evaporationRate_LperHr: 3,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.04,
  mashEfficiency_pct: 80,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1,
  calibrationNotes_md: '',
  schemaVersion: 1,
}

const recipe: Recipe = {
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
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('calcOG', () => {
  it('produces SG slightly above 1.0', () => {
    const og = calcOG(recipe, b40)
    expect(og).toBeGreaterThan(1.03)
    expect(og).toBeLessThan(1.08)
  })

  it('SMaSH 4.5kg 2-row PPG 37 in 19L at 72% bh-eff ≈ 1.053', () => {
    // 4.5 × 2.20462 × 37 × 0.72 = 264.30 points
    // 19 / 3.78541 = 5.020 gal → 264.30/5.020 = 52.65 → OG 1.053
    expect(calcOG(recipe, b40)).toBeCloseTo(1.053, 2)
  })

  it('sugar (usage=boil) gets 100% efficiency, not brewhouse', () => {
    const sugary: Recipe = {
      ...recipe,
      fermentables: [
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440102',
          snapshot: { name: 'Table Sugar', type: 'sugar', ppg: 46, color_L: 0 },
          amount_kg: 0.5,
          usage: 'boil',
          afterBoil: false,
        },
      ],
    }
    // 0.5 × 2.20462 × 46 × 1.0 = 50.69 → 50.69/5.020 = 10.10 → OG 1.010
    expect(calcOG(sugary, b40)).toBeCloseTo(1.01, 2)
  })

  it('empty grain bill returns 1.0', () => {
    expect(calcOG({ ...recipe, fermentables: [] }, b40)).toBeCloseTo(1.0, 4)
  })

  it('priming sugar (usage=bottling) does NOT inflate OG', () => {
    const baseOG = calcOG(recipe, b40)
    const withPriming: Recipe = {
      ...recipe,
      fermentables: [
        ...recipe.fermentables,
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440103',
          snapshot: { name: 'Corn Sugar (priming)', type: 'sugar', ppg: 46, color_L: 0 },
          amount_kg: 0.12,
          usage: 'bottling',
          afterBoil: true,
        },
      ],
    }
    expect(calcOG(withPriming, b40)).toBeCloseTo(baseOG, 5)
  })

  it('afterBoil / fermenter additions are excluded from pre-pitch OG', () => {
    const baseOG = calcOG(recipe, b40)
    const lateHoney: Recipe = {
      ...recipe,
      fermentables: [
        ...recipe.fermentables,
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440104',
          snapshot: { name: 'Honey', type: 'sugar', ppg: 35, color_L: 1 },
          amount_kg: 0.5,
          usage: 'fermenter',
          afterBoil: true,
        },
      ],
    }
    expect(calcOG(lateHoney, b40)).toBeCloseTo(baseOG, 5)
  })
})
