/**
 * Brewing-salt → ion contributions, derived from molar mass. All values are
 * ppm (mg/L) contributed per 1 g of salt dissolved in 1 L of water. Verified vs
 * Bru'n Water / Brewer's Friend / BYO. Keep everything per-LITER; convert to
 * g/gal only at the UI (÷3.78541).
 */
export interface IonProfile {
  Ca_ppm: number
  Mg_ppm: number
  Na_ppm: number
  SO4_ppm: number
  Cl_ppm: number
  HCO3_ppm: number
}

export const ZERO_PROFILE: IonProfile = {
  Ca_ppm: 0,
  Mg_ppm: 0,
  Na_ppm: 0,
  SO4_ppm: 0,
  Cl_ppm: 0,
  HCO3_ppm: 0,
}

export type SaltKey = 'gypsum' | 'cacl2' | 'epsom' | 'nacl' | 'nahco3'
export type CaCl2Hydrate = 'dihydrate' | 'anhydrous'
export type IonKey = 'Ca' | 'Mg' | 'Na' | 'SO4' | 'Cl' | 'HCO3'

const ION_MW: Record<IonKey, number> = {
  Ca: 40.078,
  Mg: 24.305,
  Na: 22.99,
  SO4: 96.06,
  Cl: 35.453,
  HCO3: 61.016,
}

// Ions per formula unit + salt molar mass (hydrated forms homebrewers buy).
const SALT_DEFS: Record<SaltKey, { mw: number; ions: Partial<Record<IonKey, number>> }> = {
  gypsum: { mw: 172.17, ions: { Ca: 1, SO4: 1 } }, // CaSO4·2H2O
  cacl2: { mw: 147.01, ions: { Ca: 1, Cl: 2 } }, // CaCl2·2H2O (dihydrate)
  epsom: { mw: 246.47, ions: { Mg: 1, SO4: 1 } }, // MgSO4·7H2O
  nacl: { mw: 58.44, ions: { Na: 1, Cl: 1 } },
  nahco3: { mw: 84.01, ions: { Na: 1, HCO3: 1 } },
}
const CACL2_ANHYDROUS_MW = 110.98

export function saltPpmPerGramPerL(
  salt: SaltKey,
  hydrate: CaCl2Hydrate = 'dihydrate',
): Partial<Record<IonKey, number>> {
  const def = SALT_DEFS[salt]
  const mw = salt === 'cacl2' && hydrate === 'anhydrous' ? CACL2_ANHYDROUS_MW : def.mw
  const out: Partial<Record<IonKey, number>> = {}
  for (const ion of Object.keys(def.ions) as IonKey[]) {
    const count = def.ions[ion] ?? 0
    out[ion] = ((ION_MW[ion] * count) / mw) * 1000
  }
  return out
}

const ION_FIELD: Record<IonKey, keyof IonProfile> = {
  Ca: 'Ca_ppm',
  Mg: 'Mg_ppm',
  Na: 'Na_ppm',
  SO4: 'SO4_ppm',
  Cl: 'Cl_ppm',
  HCO3: 'HCO3_ppm',
}

/** Return a NEW profile = source + dissolved salts (grams) into volume_L litres. */
export function applyAdditions(
  source: IonProfile,
  grams: Partial<Record<SaltKey, number>>,
  volume_L: number,
  hydrate: CaCl2Hydrate = 'dihydrate',
): IonProfile {
  const out: IonProfile = { ...source }
  if (volume_L <= 0) return out
  for (const salt of Object.keys(grams) as SaltKey[]) {
    const g = grams[salt] ?? 0
    if (g <= 0) continue
    const perGperL = saltPpmPerGramPerL(salt, hydrate)
    for (const ion of Object.keys(perGperL) as IonKey[]) {
      out[ION_FIELD[ion]] += ((perGperL[ion] ?? 0) * g) / volume_L
    }
  }
  return out
}
