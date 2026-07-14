/**
 * Pure brew-history aggregator for the Logbook Dashboard.
 *
 * Mirrors the dashboard pattern (`src/lib/brewing/dashboard/build-dashboard.ts`):
 * a single pure function folds the live batch list into a plain `BatchStats` the
 * presentational `<BatchDashboard>` renders. No DOM, no Dexie, no `fetch` —
 * portable + unit-tested. `now` is injected for deterministic tests.
 *
 * Dates use `brewedAt ?? startedAt` (matches `trends.ts` `dateOf`). Month/year
 * bucketing is done in UTC so the counts are timezone-independent (and tests
 * pass on any machine); empty-set averages return `null` (never `NaN`).
 */

import type { Batch } from '@/lib/brewing/types/batch'

export interface BatchStats {
  total: number
  byStatus: Record<'in-progress' | 'complete' | 'archived', number>
  brewedThisMonth: number
  brewedThisYear: number
  /** Mean of `results.measuredABV` across batches that recorded one; `null` if none. */
  avgMeasuredABV: number | null
  /** Most-brewed style, grouped by `recipeSnapshot.styleId ?? recipeSnapshot.name`. */
  mostBrewedStyle: { key: string; label: string; count: number } | null
  /** Most-brewed recipe type (`recipeSnapshot.type`, e.g. `all-grain`). */
  mostBrewedType: { type: string; count: number } | null
  /** ISO of the latest `brewedAt ?? startedAt`; `null` when there are no batches. */
  lastBrewDate: string | null
  /** Mean of `tasting.rating` across rated batches; `null` if none rated. */
  avgRating: number | null
}

/** Date a batch is considered "brewed on" — matches `trends.ts` `dateOf`. */
function dateOf(b: Batch): string {
  return b.brewedAt ?? b.startedAt
}

/** Arithmetic mean, or `null` for an empty set (so callers never see `NaN`). */
function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function buildBatchStats(batches: Batch[], now: Date = new Date()): BatchStats {
  const byStatus: BatchStats['byStatus'] = { 'in-progress': 0, complete: 0, archived: 0 }

  const nowYear = now.getUTCFullYear()
  const nowMonth = now.getUTCMonth()
  let brewedThisMonth = 0
  let brewedThisYear = 0

  let lastBrewDate: string | null = null
  let lastBrewMs = Number.NEGATIVE_INFINITY

  const abvs: number[] = []
  const ratings: number[] = []
  // Insertion-ordered so ties resolve to the first-seen group (deterministic).
  const styleCounts = new Map<string, { label: string; count: number }>()
  const typeCounts = new Map<string, number>()

  for (const b of batches) {
    byStatus[b.status]++

    const iso = dateOf(b)
    const ms = Date.parse(iso)
    if (Number.isFinite(ms)) {
      const d = new Date(ms)
      if (d.getUTCFullYear() === nowYear) {
        brewedThisYear++
        if (d.getUTCMonth() === nowMonth) brewedThisMonth++
      }
      if (ms > lastBrewMs) {
        lastBrewMs = ms
        lastBrewDate = iso
      }
    }

    if (typeof b.results.measuredABV === 'number') abvs.push(b.results.measuredABV)
    if (typeof b.tasting?.rating === 'number') ratings.push(b.tasting.rating)

    const snap = b.recipeSnapshot
    if (snap) {
      const styleKey = snap.styleId ?? snap.name
      if (styleKey) {
        const cur = styleCounts.get(styleKey)
        if (cur) cur.count++
        else styleCounts.set(styleKey, { label: snap.name || styleKey, count: 1 })
      }
      if (snap.type) typeCounts.set(snap.type, (typeCounts.get(snap.type) ?? 0) + 1)
    }
  }

  let mostBrewedStyle: BatchStats['mostBrewedStyle'] = null
  for (const [key, { label, count }] of styleCounts) {
    if (!mostBrewedStyle || count > mostBrewedStyle.count) mostBrewedStyle = { key, label, count }
  }

  let mostBrewedType: BatchStats['mostBrewedType'] = null
  for (const [type, count] of typeCounts) {
    if (!mostBrewedType || count > mostBrewedType.count) mostBrewedType = { type, count }
  }

  return {
    total: batches.length,
    byStatus,
    brewedThisMonth,
    brewedThisYear,
    avgMeasuredABV: mean(abvs),
    mostBrewedStyle,
    mostBrewedType,
    lastBrewDate,
    avgRating: mean(ratings),
  }
}
