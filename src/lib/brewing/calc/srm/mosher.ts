/**
 * Mosher SRM. SRM = 0.3 × MCU + 4.7.
 * Source: Randy Mosher Zymurgy 1993.
 */
export function calcSRMMosher(mcu: number): number {
  if (mcu <= 0) return 0
  return 0.3 * mcu + 4.7
}
