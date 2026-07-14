'use client'
import { useMemo } from 'react'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { type AdditionsResult, computeAdditions } from '@/lib/brewing/water/additions'
import type { IonProfile, SaltKey } from '@/lib/brewing/water/ions'
import {
  type AcidSuggestion,
  acidSuggestion,
  estimateMashPh,
  type MashPhResult,
} from '@/lib/brewing/water/mash-ph'
import { TARGET_PROFILES, targetForRecipe, type WaterStyleKey } from '@/lib/brewing/water/target'

export const MASH_PH_TARGET = 5.4

// Salt display labels (lifted from brew-start-gate.tsx) so the summary string is byte-identical.
const SALT_LABEL: Record<SaltKey, string> = {
  gypsum: 'Gypsum (CaSO₄)',
  cacl2: 'Calcium chloride (CaCl₂)',
  epsom: 'Epsom (MgSO₄)',
  nacl: 'Table salt (NaCl)',
  nahco3: 'Baking soda (NaHCO₃)',
}

export interface WaterPlanInput {
  recipe?: Recipe
  equipment: EquipmentProfile
  source: IonProfile
  sourceName: string
  manualStyle: WaterStyleKey
  manualVolume_L: number
  now: string
}

export interface WaterPlanResult {
  styleKey: WaterStyleKey
  add: AdditionsResult
  mash: MashPhResult | null
  acid: AcidSuggestion | null
  totalWater_L: number
  sourceName: string
  summary: string
  noAdditions: boolean
}

function summaryOf(add: AdditionsResult): string {
  const parts = (Object.keys(add.grams) as SaltKey[])
    .filter((k) => add.grams[k] > 0.05)
    .map((k) => `${SALT_LABEL[k].split(' ')[0]} ${add.grams[k].toFixed(1)} g`)
  return parts.join(' · ') || 'no additions'
}

function isNoAdditions(add: AdditionsResult): boolean {
  return (Object.keys(add.grams) as SaltKey[]).every((k) => add.grams[k] <= 0.05)
}

export function useWaterPlan(input: WaterPlanInput): WaterPlanResult | null {
  const { recipe, equipment, source, sourceName, manualStyle, manualVolume_L, now } = input
  return useMemo<WaterPlanResult | null>(() => {
    if (recipe) {
      let result: ReturnType<typeof calculateRecipe>
      try {
        result = calculateRecipe(recipe, equipment, now)
      } catch {
        return null
      }
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
      return {
        styleKey,
        add,
        mash,
        acid,
        totalWater_L,
        sourceName,
        summary: summaryOf(add),
        noAdditions: isNoAdditions(add),
      }
    }
    // Manual mode (no recipe): pick a water style + total water volume.
    const totalWater_L = Math.max(0, manualVolume_L)
    if (totalWater_L <= 0) return null
    const add = computeAdditions(source, TARGET_PROFILES[manualStyle], totalWater_L)
    return {
      styleKey: manualStyle,
      add,
      mash: null,
      acid: null,
      totalWater_L,
      sourceName,
      summary: summaryOf(add),
      noAdditions: isNoAdditions(add),
    }
  }, [recipe, equipment, source, sourceName, manualStyle, manualVolume_L, now])
}
