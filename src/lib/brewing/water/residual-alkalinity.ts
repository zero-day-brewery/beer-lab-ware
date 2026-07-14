import type { IonProfile } from './ions'

/**
 * Residual Alkalinity (Kolbach) in Palmer's ppm-as-CaCO3 convention.
 * Source: Palmer "How to Brew" / "Water" (Palmer & Kaminski); braukaiser.com.
 * Ca, Mg enter as RAW ion ppm (mg/L); alkalinity is ppm as CaCO3.
 */
export function alkalinityAsCaCO3(hco3_ppm: number): number {
  return hco3_ppm * 0.8197 // 50.04 / 61.02
}

export function residualAlkalinity(w: IonProfile): number {
  return alkalinityAsCaCO3(w.HCO3_ppm) - (w.Ca_ppm / 1.4 + w.Mg_ppm / 1.7)
}

export function ra_dH(w: IonProfile): number {
  return residualAlkalinity(w) / 17.86
}
