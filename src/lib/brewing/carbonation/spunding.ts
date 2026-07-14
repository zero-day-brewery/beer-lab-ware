import { pressureForVolumes } from '@/lib/brewing/carbonation/co2-volumes'

/**
 * Spunding setpoint: the relief-valve pressure to hold on a FERMENTING vessel
 * (or sealed keg) at FERMENTATION temperature so the beer naturally carbonates
 * to a target. Because fermentation runs warm, the required pressure is higher
 * than cold force-carb: at 12°C, 2.4–2.7 vol needs ~18–23 psi.
 *
 * If that exceeds the vessel/keg MAWP, the setpoint is capped to MAWP and the
 * result flags `finishColdInKeg` (drop temp after transfer to gain the rest of
 * the carbonation that the capped pressure can't deliver warm).
 *
 * Source: De Clerck fit; BYO / spunding references. Curve via co2-volumes.ts.
 */
export interface SpundingInput {
  targetVol: number
  fermTemp_C: number
  mawp_psi: number
}
export interface SpundingResult {
  setpoint_psi: number
  cappedToMawp: boolean
  finishColdInKeg: boolean
}

export function calcSpunding(i: SpundingInput): SpundingResult {
  const required = Math.max(0, pressureForVolumes(i.targetVol, i.fermTemp_C))
  const cappedToMawp = required > i.mawp_psi
  const setpoint_psi = cappedToMawp ? i.mawp_psi : required
  return { setpoint_psi, cappedToMawp, finishColdInKeg: cappedToMawp }
}
