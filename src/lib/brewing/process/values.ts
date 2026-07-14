/**
 * Pure value-token resolution for the guided brew manual.
 * Binds a ValueToken to the recipe/equipment/calc/water context and formats it.
 * Resolution falls back gracefully to { value: null, display: '—' } when a
 * source is missing (mirrors the try/catch in brew-start-gate.tsx).
 * Keys needing logged readings or Phase 2/3 helpers (attenuationPct, correctedFG,
 * finalABV, brewhouseEfficiency_pct, pitchCells_B, carbonation psi/vol) return the
 * fallback here and are extended in later phases.
 * PURE: no DOM/Dexie/fetch/store imports.
 */

import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'
import type { ProcessChoices, ValueToken } from './types'

export interface ResolveCtx {
  recipe?: Recipe
  equipment?: EquipmentProfile
  calc?: CalculationResult
  choices?: ProcessChoices
  water?: { estMashPh?: number; additionsSummary?: string }
}

export interface ResolvedValue {
  value: number | string | null
  display: string
}

const DASH: ResolvedValue = { value: null, display: '—' }

function fmtNumber(n: number, precision: number | undefined, unit: string | undefined): string {
  const body = n.toFixed(precision ?? 0)
  return unit ? `${body} ${unit}` : body
}

function num(value: number | undefined, token: ValueToken): ResolvedValue {
  if (value == null || Number.isNaN(value)) return DASH
  return { value, display: fmtNumber(value, token.precision, token.unit) }
}

export function injectValues(token: ValueToken, ctx: ResolveCtx): ResolvedValue {
  const { calc, recipe, equipment, water } = ctx
  switch (token.key) {
    case 'targetOG':
      return num(calc?.OG, token)
    case 'targetFG':
      return num(calc?.FG, token)
    case 'targetABV':
      return num(calc?.ABV, token)
    case 'targetIBU':
      return num(calc?.IBU, token)
    case 'targetSRM':
      return num(calc?.SRM, token)
    case 'mashWater_L':
      return num(calc?.volumes.mashWater_L, token)
    case 'spargeWater_L':
      return num(calc?.volumes.spargeWater_L, token)
    case 'preBoilVolume_L':
      return num(calc?.volumes.preBoilVolume_L, token)
    case 'postBoilVolume_L':
      return num(calc?.volumes.postBoilVolume_L, token)
    case 'intoFermenter_L':
      return num(calc?.volumes.intoFermenter_L, token)
    case 'strikeTemp_C':
      return num(calc?.strikeTemp_C, token)
    case 'mashStepTemp_C': {
      const steps = recipe?.mashSteps
      const idx = token.index === 'last' ? (steps?.length ?? 0) - 1 : (token.index ?? 0)
      return num(steps?.[idx]?.temperature_C, token)
    }
    case 'mashStepTime_min': {
      const steps = recipe?.mashSteps
      const idx = token.index === 'last' ? (steps?.length ?? 0) - 1 : (token.index ?? 0)
      return num(steps?.[idx]?.time_min, token)
    }
    case 'grainAbsorption_LperKg':
      return num(equipment?.grainAbsorption_LperKg, token)
    case 'coolingShrinkage_pct':
      return num(equipment?.coolingShrinkage_pct, token)
    case 'estMashPh':
      return num(water?.estMashPh, token)
    // Deferred to later phases (need logged readings / Phase 2-3 helpers / water gate).
    case 'stepInfusionWater_L':
    case 'fermentable':
    case 'hop':
    case 'misc':
    case 'salts':
    case 'so4cl':
    case 'acidLactic_mL':
    case 'attenuationPct':
    case 'correctedFG':
    case 'pitchCells_B':
    case 'finalABV':
    case 'brewhouseEfficiency_pct':
    case 'co2SetPsi':
    case 'spundingSetpoint_psi':
    case 'residualCo2_vol':
    case 'nitroDispense_psi':
      return DASH
  }
}
