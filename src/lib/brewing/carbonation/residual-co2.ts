import { volumesAtPressure } from '@/lib/brewing/carbonation/co2-volumes'

/**
 * Residual CO2 already dissolved in beer that was held under spunding pressure
 * and then cold-crashed. Evaluated at the ACTUAL crash temperature via Henry's
 * law: colder beer at the same head pressure holds more CO2. This volume is the
 * credit subtracted before deciding any force-carb top-up.
 *
 * Source: Henry's law; Braukaiser / Troester. Curve via co2-volumes.ts.
 */
export function residualCo2Vol(i: { spundSetpoint_psi: number; crashTemp_C: number }): number {
  return Math.max(0, volumesAtPressure(i.spundSetpoint_psi, i.crashTemp_C))
}
