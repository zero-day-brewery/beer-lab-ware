import { sgToPlato } from '@/lib/brewing/convert/gravity'

/**
 * Yeast pitch rate (Mitch/White-Zainasheff model):
 *   cells (billion) = rate (million cells / mL / °Plato) × volume (mL) × °Plato
 *
 * Rates: ale 0.75, lager/pressure 1.5, high-gravity 1.0 (a heavier ale pitch).
 * °Plato is derived from OG via sgToPlato. Report this as cells needed; dry
 * yeast supplies ~20 B viable cells per gram TOTAL (≠ the marketing "viable
 * ~150 B/sachet" figure) — divide cells_B by 20 to size dry yeast grams.
 *
 * Source: White & Zainasheff, "Yeast" (2010).
 */
export type PitchStyle = 'ale' | 'lager' | 'pressure' | 'high-gravity'

export interface PitchRateInput {
  batchSize_L: number
  og: number
  style: PitchStyle
}
export interface PitchRateResult {
  plato: number
  rate_M_per_mL_per_P: number
  cells_B: number
}

const RATE_BY_STYLE: Record<PitchStyle, number> = {
  ale: 0.75,
  lager: 1.5,
  pressure: 1.5,
  'high-gravity': 1.0,
}

export function calcPitchRate(i: PitchRateInput): PitchRateResult {
  const plato = sgToPlato(i.og)
  const rate_M_per_mL_per_P = RATE_BY_STYLE[i.style]
  const volume_mL = i.batchSize_L * 1000
  // rate (M cells / mL / °P) × mL × °P = M cells; ÷ 1000 → billion cells
  const cells_B = (rate_M_per_mL_per_P * volume_mL * plato) / 1000
  return { plato, rate_M_per_mL_per_P, cells_B }
}
