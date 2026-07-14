/**
 * Proactive-insights types — the shared shape for the deterministic, offline
 * insights engine (Companion v3 Stage A).
 *
 * An {@link Insight} is a single timely nudge derived PURELY from the brewer's
 * own data (batches + fermentation readings + inventory). Detection needs no
 * AI/API key and burns no tokens — the companion layers on top later to explain
 * or act on an insight (that's why each carries an {@link Insight.ask} seed).
 *
 * No DOM, no Dexie, no `fetch`, no `Date.now()` — mirrors the pure-aggregator
 * pattern of `dashboard/build-dashboard.ts` + `batch/batch-stats.ts` so the
 * module stays portable + unit-testable (see project CLAUDE.md conventions).
 */

/** The detector that produced an insight. Also the stable-id prefix. */
export type InsightKind =
  | 'stuck_fermentation'
  | 'ready_to_package'
  | 'aging_hops'
  | 'low_stock'
  | 'yeast_low_viability'

/**
 * Urgency of a nudge. Ranking uses this first (urgent > warn > info), then
 * recency. `info` = positive/FYI (e.g. ready-to-package), `warn` = attention
 * soon (aging hops, low stock), `urgent` = act now (badly stuck, out of stock).
 */
export type InsightSeverity = 'info' | 'warn' | 'urgent'

/** What an insight points back at, so a UI/companion can deep-link + act. */
export type InsightRelatedType = 'batch' | 'inventory' | 'recipe'

export interface Insight {
  /** Stable, deterministic id derived from `kind + ':' + relatedId` — the same
   *  data always yields the same id (so a UI can dedupe/dismiss across runs). */
  id: string
  kind: InsightKind
  severity: InsightSeverity
  /** One-line headline. */
  title: string
  /** A sentence of grounded context (cites the brewer's actual numbers). */
  detail: string
  relatedType?: InsightRelatedType
  relatedId?: string
  /** A one-line question seed the companion (v3 Stage B+) can hand to the model
   *  to explain/act on THIS insight — pre-grounded in the brewer's own data. */
  ask?: string
  /** ISO timestamp of the signal this insight is about (latest reading / purchase
   *  date / stock change). Additive to the core shape — drives the "then recency"
   *  ranking in {@link buildInsights} and relative-time UI later. Absent when the
   *  source datum is undated. */
  at?: string
}
