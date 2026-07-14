import { describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { computeAdditions } from '@/lib/brewing/water/additions'
import { type IonProfile, type SaltKey, ZERO_PROFILE } from '@/lib/brewing/water/ions'
import { acidSuggestion, estimateMashPh } from '@/lib/brewing/water/mash-ph'
import { targetForRecipe } from '@/lib/brewing/water/target'

const MASH_PH_TARGET = 5.4

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40',
  isDefault: true,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 2,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.5,
  evaporationRate_LperHr: 1,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1,
  mashEfficiency_pct: 78,
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
  name: 'House Pale',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: b40.id,
  grainTemp_C: 20,
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440201',
      snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
      amount_g: 30,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

// Tap-water-ish source so additions are non-trivial.
const source: IonProfile = { ...ZERO_PROFILE, Ca_ppm: 25, Cl_ppm: 20, HCO3_ppm: 60 }

// Recreates brew-start-gate.tsx lines 67-95 EXACTLY for the recipe branch.
function modalCompute() {
  const result = calculateRecipe(recipe, b40, '2026-06-25T00:00:00.000Z')
  const gu = (result.OG - 1) * 1000
  const buGu = gu > 0 ? result.IBU / gu : 0
  const { styleKey, target } = targetForRecipe(result.SRM, buGu)
  const totalWater_L = result.volumes.mashWater_L + result.volumes.spargeWater_L
  const add = computeAdditions(source, target, totalWater_L)
  const gristKg = recipe.fermentables
    .filter(
      (f) => f.usage === 'mash' && f.snapshot.type !== 'sugar' && f.snapshot.type !== 'extract',
    )
    .reduce((a, f) => a + f.amount_kg, 0)
  const mash = estimateMashPh(recipe, add.result, recipe.batchSize_L)
  const acid = acidSuggestion(mash.ph, MASH_PH_TARGET, gristKg)
  return { styleKey, add, mash, acid, totalWater_L, gristKg }
}

describe('water-plan golden (characterization of brew-start-gate compute)', () => {
  const c = modalCompute()

  it('produces a stable totalWater_L and a defined style key', () => {
    expect(c.styleKey).toBeTruthy()
    expect(c.totalWater_L).toBeGreaterThan(0)
  })

  it('snapshots the salt grams, so4cl, mash pH and acid (the numbers the hook must reproduce)', () => {
    const grams = Object.fromEntries(
      (Object.keys(c.add.grams) as SaltKey[]).map((k) => [k, Number(c.add.grams[k].toFixed(3))]),
    )
    expect({
      styleKey: c.styleKey,
      totalWater_L: Number(c.totalWater_L.toFixed(3)),
      grams,
      so4cl: Number.isFinite(c.add.so4cl) ? Number(c.add.so4cl.toFixed(3)) : 'inf',
      mashPh: Number(c.mash.ph.toFixed(3)),
      lactic88_mL: c.acid ? Number(c.acid.lactic88_mL.toFixed(3)) : null,
      warnings: c.add.warnings,
    }).toMatchSnapshot()
  })

  it('manual mode (no recipe): style + total water only, no mash/acid', () => {
    // mirrors brew-start-gate.tsx lines 90-94
    const totalWater_L = 30
    const add = computeAdditions(source, targetForRecipe(6, 0.5).target, totalWater_L)
    expect(add.grams).toBeDefined()
    expect(totalWater_L).toBe(30)
  })
})
