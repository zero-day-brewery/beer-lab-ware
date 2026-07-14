import { sgToPlato } from '@/lib/brewing/convert/gravity'
import type { GravityUnit } from '@/lib/brewing/types/settings'

/** Display a specific gravity in the user's chosen unit. Plato keeps SG in parens. */
export function formatGravity(sg: number, unit: GravityUnit = 'sg'): string {
  if (unit === 'plato') return `${sgToPlato(sg).toFixed(1)} °P (${sg.toFixed(3)})`
  return sg.toFixed(3)
}
