import {
  applyAdditions,
  type CaCl2Hydrate,
  type IonKey,
  type IonProfile,
  type SaltKey,
  saltPpmPerGramPerL,
} from './ions'

export interface AdditionsResult {
  grams: Record<SaltKey, number>
  result: IonProfile
  so4cl: number
  warnings: string[]
}

export interface AdditionsOpts {
  hydrate?: CaCl2Hydrate
  bakingSoda?: boolean // default true (only used when a dark target needs HCO3)
}

/**
 * Deterministic, explainable salt additions (NOT an optimizer): Epsom for Mg,
 * gypsum for the remaining SO4 deficit, CaCl2 for Cl, baking soda for HCO3.
 * Calcium falls out as a byproduct and is checked against guardrails.
 */
export function computeAdditions(
  source: IonProfile,
  target: IonProfile,
  volume_L: number,
  opts: AdditionsOpts = {},
): AdditionsResult {
  const hydrate = opts.hydrate ?? 'dihydrate'
  const grams: Record<SaltKey, number> = { gypsum: 0, cacl2: 0, epsom: 0, nacl: 0, nahco3: 0 }
  const warnings: string[] = []

  const gramsFor = (salt: SaltKey, ion: IonKey, deltaPpm: number): number => {
    const perGperL = saltPpmPerGramPerL(salt, hydrate)[ion] ?? 0
    return perGperL > 0 && deltaPpm > 0 && volume_L > 0 ? (deltaPpm * volume_L) / perGperL : 0
  }

  const so4Deficit = target.SO4_ppm - source.SO4_ppm
  const clDeficit = target.Cl_ppm - source.Cl_ppm
  const mgDeficit = target.Mg_ppm - source.Mg_ppm
  const hco3Deficit = target.HCO3_ppm - source.HCO3_ppm

  // Epsom first (it also contributes SO4, which we subtract from the gypsum need).
  grams.epsom = gramsFor('epsom', 'Mg', mgDeficit)
  const so4FromEpsom =
    volume_L > 0 ? (grams.epsom * (saltPpmPerGramPerL('epsom').SO4 ?? 0)) / volume_L : 0
  grams.gypsum = gramsFor('gypsum', 'SO4', so4Deficit - so4FromEpsom)
  grams.cacl2 = gramsFor('cacl2', 'Cl', clDeficit)
  if (opts.bakingSoda !== false) grams.nahco3 = gramsFor('nahco3', 'HCO3', hco3Deficit)

  if (so4Deficit < 0) warnings.push('Source SO₄ already above target — dilute with RO to lower it.')
  if (clDeficit < 0) warnings.push('Source Cl already above target — dilute with RO to lower it.')
  if (hco3Deficit < 0)
    warnings.push('Source alkalinity above target — dilute with RO or add acid (see mash pH).')

  const result = applyAdditions(source, grams, volume_L, hydrate)

  if (result.Ca_ppm < 50)
    warnings.push('Calcium < 50 ppm — may hinder enzymes, yeast, and clarity.')
  if (result.Ca_ppm > 200) warnings.push('Calcium > 200 ppm — can taste minerally/chalky.')
  if (result.Mg_ppm > 30) warnings.push('Magnesium > 30 ppm — can taste harsh/metallic.')
  if (result.Na_ppm > 150) warnings.push('Sodium > 150 ppm — can taste salty.')

  const so4cl = result.Cl_ppm > 0 ? result.SO4_ppm / result.Cl_ppm : Number.POSITIVE_INFINITY
  return { grams, result, so4cl, warnings }
}
