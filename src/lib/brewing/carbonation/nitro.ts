/**
 * Nitro (beer-gas) dispense plan. Nitro service is KEG-only at high dispense
 * pressure through a restrictor (stout) faucet — NEVER applied to the ~15-psi
 * fermenter, and NEVER through a 17/35-psi PRV (too low: nitro kegs run ~30 psi,
 * so the PRV must be rated ≥ 65 psi).
 *
 * Beer is carbonated LOW with CO2 (~1.2–1.5 vol) first, then pushed with a
 * 75/25 (N2/CO2) beer-gas blend at ~30 psi (25–35 acceptable). `style` is
 * advisory only — the plan is a fixed safety/service spec.
 *
 * Source: Brewers Association Draft Quality Manual; Micro Matic.
 */
export interface NitroPlan {
  blend: '75/25' | '70/30'
  dispense_psi: number
  lowCo2Vol: number
  minPrvRating_psi: number
}

export function nitroPlan(_i: { style?: string }): NitroPlan {
  return {
    blend: '75/25',
    dispense_psi: 30,
    lowCo2Vol: 1.4,
    minPrvRating_psi: 65,
  }
}
