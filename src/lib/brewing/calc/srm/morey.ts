/**
 * Morey SRM. SRM = 1.4922 × MCU^0.6859, capped at 50 (SRM scale is undefined above ~50).
 * Source: Dan Morey, HBD mailing list.
 */
export const calcSRMMorey = (mcu: number): number => {
  if (mcu === 0) return 0
  return Math.min(1.4922 * mcu ** 0.6859, 50)
}
