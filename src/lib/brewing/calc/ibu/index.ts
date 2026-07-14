import type { IBUFormula } from '@/lib/brewing/types/equipment'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'
import { calcIBUDaniels } from './daniels'
import { calcIBUGaretz } from './garetz'
import { calcIBURager } from './rager'
import { calcIBUTinseth } from './tinseth'

/**
 * Dispatch to an IBU model. Per the canonical definitions, `boilGravity` is the
 * AVERAGE BOIL GRAVITY and `postBoilVolume_L` is the post-boil kettle volume.
 */
export function calcIBU(
  hops: HopUse[],
  boilGravity: number,
  postBoilVolume_L: number,
  hopUtilizationMultiplier: number,
  formula: IBUFormula,
): number {
  switch (formula) {
    case 'tinseth':
      return calcIBUTinseth(hops, boilGravity, postBoilVolume_L, hopUtilizationMultiplier)
    case 'rager':
      return calcIBURager(hops, boilGravity, postBoilVolume_L, hopUtilizationMultiplier)
    case 'garetz':
      return calcIBUGaretz(hops, boilGravity, postBoilVolume_L, hopUtilizationMultiplier)
    case 'daniels':
      return calcIBUDaniels(hops, boilGravity, postBoilVolume_L, hopUtilizationMultiplier)
  }
}
