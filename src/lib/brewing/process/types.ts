import type { FermStatus } from '@/stores/system-store'

export type StageId = 'prep' | 'hotside' | 'fermentation' | 'packaging' | 'conditioning'
export type StepId = string // verified kebab ids, e.g. 'pitch-yeast', 'ramp-to-boil'

export type ValueKey =
  | 'targetOG'
  | 'targetFG'
  | 'targetABV'
  | 'targetIBU'
  | 'targetSRM'
  | 'mashWater_L'
  | 'spargeWater_L'
  | 'preBoilVolume_L'
  | 'postBoilVolume_L'
  | 'intoFermenter_L'
  | 'strikeTemp_C'
  | 'mashStepTemp_C'
  | 'mashStepTime_min'
  | 'stepInfusionWater_L'
  | 'fermentable'
  | 'hop'
  | 'misc'
  | 'salts'
  | 'so4cl'
  | 'estMashPh'
  | 'acidLactic_mL'
  | 'attenuationPct'
  | 'correctedFG'
  | 'grainAbsorption_LperKg'
  | 'coolingShrinkage_pct'
  | 'pitchCells_B'
  | 'finalABV'
  | 'brewhouseEfficiency_pct'
  | 'co2SetPsi'
  | 'spundingSetpoint_psi'
  | 'residualCo2_vol'
  | 'nitroDispense_psi'

export interface ValueToken {
  key: ValueKey
  label: string
  unit?: string
  source: 'recipe' | 'equipment' | 'calc' | 'water' | 'choice' | 'derived'
  precision?: number
  /** Numeric index into a recipe array (e.g. mashSteps[0]).
   *  Use 'last' to resolve the final element of the array (e.g. the mash-out step). */
  index?: number | 'last'
}

export type LogFieldKind = 'number' | 'text' | 'bool' | 'gravity' | 'temp' | 'time'
export interface BoardWrite {
  target: 'fermenter' | 'currentBrew'
  field: string
}
export interface LogField {
  key: string
  label: string
  kind: LogFieldKind
  unit?: string
  required?: boolean
  writesTo?: BoardWrite
  targetValueKey?: ValueKey
}

export interface TimerSpec {
  id: string
  label: string
  durationFrom:
    | { kind: 'fixed'; minutes: number }
    | { kind: 'recipe'; path: 'boilTime_min' }
    | { kind: 'mashStep'; index: number }
  isBoilMaster?: boolean
}

export type BranchPredicate =
  | { t: 'stepMash' }
  | { t: 'hasMashOut' }
  | { t: 'hasWhirlpool' }
  | { t: 'hasDryHop' }
  | { t: 'hasMiscs' }
  | { t: 'noSparge' }
  | { t: 'carbPath'; eq: 'co2' | 'nitro' }
  | { t: 'usesStarter' }
  | { t: 'pressureFromPitch' }
  | { t: 'not'; of: BranchPredicate }

export type BoardEffect =
  | { t: 'startSession' }
  | { t: 'station'; station: 'brew' | 'wortChiller' | 'cooler'; to: 'idle' | 'active' }
  | { t: 'fermenter'; to: FermStatus }
  | { t: 'stageFocus'; stage: StageId }
  | { t: 'endSession' }
  | { t: 'note'; text: string }

// Branch choices made by the operator. Phase 3 SessionChoices is structurally identical.
export interface ProcessChoices {
  carbPath?: 'co2' | 'nitro'
  noSparge?: boolean
  usesStarter?: boolean
  pressureFromPitch?: boolean
}

export interface ProcessStep {
  id: StepId
  title: string
  body_md: string
  values: ValueToken[]
  logs: LogField[]
  timers: TimerSpec[]
  enterEffects?: BoardEffect[]
  completeEffects?: BoardEffect[]
  branch?: BranchPredicate
  safety_md?: string
}
export interface ProcessStage {
  id: StageId
  title: string
  steps: ProcessStep[]
}
export interface ProcessManual {
  version: number
  stages: ProcessStage[]
}
