/**
 * Daniels SRM.
 *   SRM = MCU              for MCU ≤ 5
 *   SRM = 0.2 × MCU + 8.4  for MCU > 5
 * Source: Ray Daniels "Designing Great Beers" ch.4.
 */
export function calcSRMDaniels(mcu: number): number {
  if (mcu <= 0) return 0
  if (mcu <= 5) return mcu
  return 0.2 * mcu + 8.4
}
