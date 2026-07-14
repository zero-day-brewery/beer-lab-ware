import { describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { CalculationResultSchema } from '@/lib/brewing/types/results'

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
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

const smash: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH Pale Ale',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: b40.id,
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440201',
      snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
      amount_g: 28,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440301',
      snapshot: { name: 'US-05', attenuation_min_pct: 75, attenuation_max_pct: 82, form: 'dry' },
      amount: 11.5,
    },
  ],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('calculateRecipe', () => {
  it('produces a CalculationResult that passes its own schema', () => {
    const r = calculateRecipe(smash, b40, '2026-05-12T13:00:00.000Z')
    expect(() => CalculationResultSchema.parse(r)).not.toThrow()
  })

  it('SMaSH numbers in expected ranges', () => {
    const r = calculateRecipe(smash, b40, '2026-05-12T13:00:00.000Z')
    expect(r.OG).toBeGreaterThan(1.04)
    expect(r.OG).toBeLessThan(1.07)
    expect(r.FG).toBeGreaterThan(1.005)
    expect(r.FG).toBeLessThan(1.02)
    expect(r.ABV).toBeGreaterThan(4)
    expect(r.ABV).toBeLessThan(8)
    expect(r.IBU).toBeGreaterThan(15)
    expect(r.IBU).toBeLessThan(35)
    expect(r.SRM).toBeGreaterThan(2)
    expect(r.SRM).toBeLessThan(10)
  })

  it('records formulas used', () => {
    const r = calculateRecipe(smash, b40, '2026-05-12T13:00:00.000Z')
    expect(r.formulasUsed.ibu).toBe('tinseth')
    expect(r.formulasUsed.srm).toBe('morey')
    expect(r.formulasUsed.abv).toBe('simple')
  })

  it('records computedAt from caller', () => {
    const ts = '2026-05-12T13:00:00.000Z'
    expect(calculateRecipe(smash, b40, ts).computedAt).toBe(ts)
  })

  it('strike temp around 72-74 for 66°C target', () => {
    const r = calculateRecipe(smash, b40, '2026-05-12T13:00:00.000Z')
    expect(r.strikeTemp_C).toBeGreaterThan(70)
    expect(r.strikeTemp_C).toBeLessThan(76)
  })

  it('handles missing mashSteps without crashing', () => {
    const noMash: Recipe = { ...smash, mashSteps: [] }
    const r = calculateRecipe(noMash, b40, '2026-05-12T13:00:00.000Z')
    expect(typeof r.strikeTemp_C).toBe('number')
  })
})
