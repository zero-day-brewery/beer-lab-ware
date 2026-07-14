import type { Water } from '@/lib/brewing/types/ingredient'

/**
 * Shared-scale ion bars for comparing source-water profiles at a glance.
 *
 * The Water tab renders 7 profiles side-by-side; comparing raw ppm digits across
 * rows is slow. `ionBarScale` turns each profile's 6 ions into a fraction of the
 * SHARED per-ion max across every profile, so a full bar always means "the
 * mineral-richest profile for this ion" and the columns are directly comparable.
 *
 * Pure: no DOM, no Dexie, no fetch — portable to native later. Unit-tested.
 */

/** The 6 source-water ion fields, canonical display order (Ca → HCO₃). */
export const ION_BAR_FIELDS = [
  'Ca_ppm',
  'Mg_ppm',
  'Na_ppm',
  'SO4_ppm',
  'Cl_ppm',
  'HCO3_ppm',
] as const

export type IonBarField = (typeof ION_BAR_FIELDS)[number]

/** Minimal ppm-bearing shape — anything exposing the 6 ion fields (Water qualifies). */
export type IonBearing = Pick<Water, IonBarField>

export interface IonBarScale {
  /** Shared per-ion max across every profile. 0 when all profiles read 0 (e.g. RO). */
  max: Record<IonBarField, number>
  /** Per-profile fraction in [0,1] for each ion, index-aligned to the input array. */
  fractions: Record<IonBarField, number>[]
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : 0)

/**
 * Compute the shared per-ion max across `profiles` and each profile's [0,1]
 * fraction of that max.
 *
 * - Shared max: for each ion, the largest value seen across all profiles.
 * - Fraction: `value / max`, clamped to [0,1]. Negatives/NaN clamp to 0.
 * - All-zero (or a max of 0) → fraction 0, i.e. an empty bar (RO / distilled).
 * - Empty input → all maxes 0 and an empty `fractions` array.
 */
export function ionBarScale(profiles: readonly IonBearing[]): IonBarScale {
  const max = {} as Record<IonBarField, number>
  for (const field of ION_BAR_FIELDS) {
    let m = 0
    for (const p of profiles) {
      const v = p[field]
      if (Number.isFinite(v) && v > m) m = v
    }
    max[field] = m
  }

  const fractions = profiles.map((p) => {
    const row = {} as Record<IonBarField, number>
    for (const field of ION_BAR_FIELDS) {
      const m = max[field]
      row[field] = m > 0 ? clamp01(p[field] / m) : 0
    }
    return row
  })

  return { max, fractions }
}
