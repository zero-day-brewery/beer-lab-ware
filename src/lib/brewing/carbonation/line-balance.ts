/**
 * Balanced draft-line length: line ≈ serving pressure ÷ line resistance.
 * Default resistance is the textbook 2 psi/ft, but real 3/16" ID beer line
 * runs only ≈1–1.5 psi/ft, so the 2 psi/ft answer is intentionally SHORT —
 * lengthen toward the 1.5 psi/ft figure if pours come out foamy.
 *
 * Source: Brewers Association; BeerSmith line-balancing notes.
 */
export function balancedLineLength_ft(i: {
  servingPsi: number
  resistance_psiPerFt?: number
}): number {
  const resistance = i.resistance_psiPerFt ?? 2
  if (resistance <= 0) return 0
  return Math.max(0, i.servingPsi) / resistance
}
