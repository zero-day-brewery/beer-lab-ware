import { cToF } from '@/lib/brewing/convert/temp'

/**
 * Canonical CO2 solubility curve for the whole app. Forward + inverse of the
 * De Clerck / Henry's-law fit used by Brewer's Friend:
 *   vols = (P + 14.695)·(0.01821 + 0.09011·e^(−(Tf − 32)/43.11)) − 0.003342
 * where P is gauge pressure (psi) and Tf is beer temperature (°F).
 *
 * This is the SINGLE source of truth — spunding, force-carb, residual-co2,
 * nitro and line-balance all import from here. Do not duplicate the fit.
 *
 * Source: Henry's-law / De Clerck CO2 fit; Brewer's Friend carbonation calc.
 */
function henryCoefficient(temp_C: number): number {
  const tf = cToF(temp_C)
  return 0.01821 + 0.09011 * Math.exp(-(tf - 32) / 43.11)
}

/** Dissolved CO2 (volumes) held at a given gauge pressure and beer temp. */
export function volumesAtPressure(psi: number, temp_C: number): number {
  return (psi + 14.695) * henryCoefficient(temp_C) - 0.003342
}

/** Gauge pressure (psi) needed to reach a target carbonation at a beer temp. */
export function pressureForVolumes(targetVol: number, temp_C: number): number {
  return (targetVol + 0.003342) / henryCoefficient(temp_C) - 14.695
}
