import { kgToLb } from '@/lib/brewing/convert/mass'
import { lToGal } from '@/lib/brewing/convert/volume'
import type { SRMFormula } from '@/lib/brewing/types/equipment'
import type { FermentableUse } from '@/lib/brewing/types/recipe-parts'
import { calcSRMDaniels } from './daniels'
import { calcSRMMorey } from './morey'
import { calcSRMMosher } from './mosher'

/**
 * Malt Color Units. MCU = Σ(weight_lb × color_L) / batch_gal.
 */
export function calcMCU(fermentables: FermentableUse[], volume_L: number): number {
  if (volume_L === 0) return 0
  const gal = lToGal(volume_L)
  let sum = 0
  for (const f of fermentables) {
    sum += kgToLb(f.amount_kg) * f.snapshot.color_L
  }
  return sum / gal
}

export function calcSRM(
  fermentables: FermentableUse[],
  volume_L: number,
  formula: SRMFormula,
): number {
  const mcu = calcMCU(fermentables, volume_L)
  switch (formula) {
    case 'morey':
      return calcSRMMorey(mcu)
    case 'daniels':
      return calcSRMDaniels(mcu)
    case 'mosher':
      return calcSRMMosher(mcu)
  }
}
