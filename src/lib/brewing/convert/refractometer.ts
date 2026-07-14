import { sgToBrix } from './gravity'

/**
 * Sean Terrill cubic refractometer correction for post-ferment readings.
 * Source: http://seanterrill.com/2011/04/07/refractometer-fg-results/
 *
 * Wort Correction Factor (WCF) is fixed at the default 1.0 here: Brix values
 * are used as read. If a per-instrument WCF is ever exposed in the UI, divide
 * EACH Brix input by WCF before applying the cubic (ogBrix/WCF, fgBrix/WCF) —
 * most homebrew refractometers calibrate to sucrose and run WCF ≈ 1.02–1.04.
 *
 * When fgRefracReadAsSG >= ogSG (no Brix drop = no fermentation), returns ogSG
 * unchanged — the correction formula only applies once alcohol is present.
 */
export function correctedFG(ogSG: number, fgRefracReadAsSG: number): number {
  const ogBrix = sgToBrix(ogSG)
  const fgBrix = sgToBrix(fgRefracReadAsSG)
  if (fgBrix >= ogBrix) return ogSG
  return (
    1.0 -
    0.0044993 * ogBrix +
    0.011774 * fgBrix +
    0.00027581 * ogBrix ** 2 -
    0.0012717 * fgBrix ** 2 -
    0.00000728 * ogBrix ** 3 +
    0.000063293 * fgBrix ** 3
  )
}
