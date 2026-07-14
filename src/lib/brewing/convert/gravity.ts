/**
 * SG ↔ Plato/Brix conversions.
 * sgToPlato: cubic polynomial from Brewer's Friend (fits ASBC data to ±0.03°P).
 * platoToSG: Balling inverse; matches ASBC Beer-1 table to ±0.0001 SG.
 * Sources: Palmer "How to Brew" 4e; ASBC Methods of Analysis Beer-1.
 */
export function sgToPlato(sg: number): number {
  return 135.997 * sg ** 3 - 630.272 * sg ** 2 + 1111.14 * sg - 616.868
}

export function platoToSG(plato: number): number {
  return 1 + plato / (258.6 - (plato / 258.2) * 227.1)
}

export const sgToBrix = (sg: number): number => sgToPlato(sg)
export const brixToSG = (brix: number): number => platoToSG(brix)

/**
 * Round a specific gravity to its conventional 3-decimal precision (e.g. 1.010).
 * Use before persisting a computed gravity (correctedFG, etc.) so stored values
 * match what the UI displays instead of carrying spurious float precision.
 */
export const roundSG = (sg: number): number => Math.round(sg * 1000) / 1000
