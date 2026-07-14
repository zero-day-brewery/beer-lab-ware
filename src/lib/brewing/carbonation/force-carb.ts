import { pressureForVolumes } from '@/lib/brewing/carbonation/co2-volumes'

/**
 * Force-carbonation SET pressure: the regulator pressure to leave on a keg at
 * its serving temperature to reach a target carbonation (set-and-forget).
 *
 * This is SET pressure, distinct from DISPENSE pressure (dispense is driven by
 * line balance, see line-balance.ts). 2.4 vol @ 4°C ≈ 11 psi.
 *
 * Source: Henry's-law carbonation chart; AHA. Curve via co2-volumes.ts.
 */
export interface ForceCarbInput {
  targetVol: number
  servingTemp_C: number
}
export interface ForceCarbResult {
  setPsi: number
}

export function calcForceCarb(i: ForceCarbInput): ForceCarbResult {
  const setPsi = pressureForVolumes(i.targetVol, i.servingTemp_C)
  return { setPsi: Math.max(0, setPsi) }
}
