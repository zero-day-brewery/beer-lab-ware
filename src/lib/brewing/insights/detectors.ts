/**
 * Proactive-insights detectors — the free, offline, always-on layer.
 *
 * PURE + DETERMINISTIC: everything is injected (`now` + data), so there is no
 * `Date.now()`, no DOM, no Dexie, no `fetch`, and no provider/API-key
 * dependency. Detection is pure rule-based scanning of the brewer's own data;
 * the AI companion layers on top LATER to explain/act on an insight (the v3
 * "proactive" phase).
 *
 * Models reused (thresholds NOT reinvented):
 *  - `inventory/freshness.ts` → {@link hopAge} cold-storage hop bands (aging_hops).
 *  - `types/inventory.ts` → {@link isLowStock} threshold logic (low_stock).
 *  - `batch/batch-stats.ts` → the `dateOf(brewedAt ?? startedAt)` convention
 *    (replicated below as the brewed-on date; the source's `dateOf` is private).
 *  - `dashboard/build-dashboard.ts` → the pure-aggregator style + the
 *    `isReadyToColdCrash` tolerance (`sg <= fg + 0.002`), reused as READY_NEAR_FG.
 *
 * ── Detector set & thresholds (homebrew heuristics — nudge, don't condemn) ───
 *  stuck_fermentation: an in-progress batch fermenting >= 4 days whose gravity
 *    has NOT meaningfully dropped over a >= 2-day recent span (< 2 gravity
 *    points) AND is still well above the recipe target FG (> 10 points). urgent
 *    when >= 20 points above FG (badly stuck). Refs: Palmer "How to Brew";
 *    White & Zainasheff "Yeast" — a healthy ale is usually near terminal by
 *    ~day 4–7, so flat + high after day 4 is suspicious.
 *  ready_to_package: an in-progress batch AT/near target FG (<= FG + 2 points,
 *    the dashboard's cold-crash tolerance) AND stable (< 2-point drop) over a
 *    >= 2-day span -> "ready to cold-crash / package."
 *  aging_hops: an inventory hop past the freshness band (`hopAge` state 'aging'
 *    6–12 mo -> info, or 'old' >12 mo -> warn) -> "use soon / vacuum-seal."
 *  low_stock: an inventory item at/below its low-stock threshold OR below its
 *    par level -> "restock" (urgent when 0 on hand). NOTE: overlaps the
 *    dashboard's single AGGREGATE low-stock attention row — this emits ONE
 *    insight PER item (finer grain + a per-item `ask`/`relatedId`), so it is not
 *    a verbatim duplicate; a UI that shows both should prefer one surface.
 *
 * The 2-point (0.002 SG) flat tolerance is deliberately the SAME number the
 * dashboard uses for "at FG", so stuck (well above FG) and ready (at FG) are
 * mutually exclusive and a batch can never fire both.
 */

import { hopAge } from '@/lib/brewing/inventory/freshness'
import { VIABILITY_FLOOR_PCT } from '@/lib/brewing/inventory/yeast-selection'
import { currentViability } from '@/lib/brewing/inventory/yeast-viability'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { isLowStock } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import { isInStock, type YeastLot } from '@/lib/brewing/types/yeast-lot'
import type { Insight, InsightSeverity } from './types'

const DAY = 86_400_000

// stuck_fermentation
const STUCK_MIN_FERMENT_DAYS = 4
const STUCK_SPAN_DAYS = 2
const STUCK_MIN_DROP = 0.002
const STUCK_ABOVE_FG = 0.01
const STUCK_URGENT_ABOVE_FG = 0.02

// ready_to_package (READY_NEAR_FG mirrors dashboard `isReadyToColdCrash`)
const READY_NEAR_FG = 0.002
const READY_STABLE_DAYS = 2
const READY_STABLE_DROP = 0.002

/** Injected context — pure inputs, no live handles. */
export interface InsightContext {
  batches: Batch[]
  /** Readings keyed by `Batch.id` (matches the readings repo's `listByBatch`). */
  readingsByBatch: Record<string, Reading[]>
  inventory: InventoryItem[]
  /** Yeast lots for the viability-floor nudge. Optional so legacy callers/tests
   *  that predate the yeast feature keep working (treated as `[]`). */
  yeastLots?: YeastLot[]
  /** Injected for determinism (never `new Date()` inside). */
  now: Date
}

// yeast_low_viability — warn as a lot approaches the direct-pitch floor, urgent
// once below it. The warn band opens VIABILITY_WARN_BAND_PCT above the floor so
// the brewer is nudged to use/step-up a lot BEFORE it decays past usefulness.
const VIABILITY_WARN_BAND_PCT = 15

// ── shared helpers ──────────────────────────────────────────────────────────

/** Brewed-on date — mirrors `batch-stats.ts` / `trends.ts` `dateOf`. */
function dateOf(b: Batch): string | undefined {
  return b.brewedAt ?? b.startedAt
}

/** Fractional days since an ISO instant, or `null` when missing/unparseable. */
function daysSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null
  const ms = now.getTime() - Date.parse(iso)
  return Number.isFinite(ms) ? ms / DAY : null
}

/**
 * Target FG for a batch. Prefers the recipe snapshot's stated target
 * (`recipeSnapshot.targets.FG`, per spec); falls back to the computed FG
 * (`computedTargets.FG`) so a batch created from a calc still resolves a target.
 * Returns `undefined` when neither is a finite number (guard: no target FG).
 */
function targetFG(b: Batch): number | undefined {
  const stated = b.recipeSnapshot?.targets?.FG
  if (typeof stated === 'number' && Number.isFinite(stated)) return stated
  const computed = b.computedTargets?.FG
  if (typeof computed === 'number' && Number.isFinite(computed)) return computed
  return undefined
}

interface GravitySample {
  at: string
  t: number
  gravity: number
}

/** Readings that carry a finite gravity + a parseable `at`, sorted oldest→newest.
 *  Mirrors `ferment-chart.ts`: drop unparseable timestamps, sort by time. */
function gravitySamples(readings: Reading[] | undefined): GravitySample[] {
  if (!readings) return []
  const out: GravitySample[] = []
  for (const r of readings) {
    if (typeof r.gravity !== 'number' || !Number.isFinite(r.gravity)) continue
    const t = Date.parse(r.at)
    if (!Number.isFinite(t)) continue
    out.push({ at: r.at, t, gravity: r.gravity })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** The most-recent sample taken at least `spanDays` before `latestT`, else null.
 *  Ensures a trend is measured over a real time gap (not two readings hours
 *  apart), so a sub-2-point delta genuinely means "flat". */
function priorAtLeastDaysBefore(
  samples: GravitySample[],
  latestT: number,
  spanDays: number,
): GravitySample | null {
  const cutoff = latestT - spanDays * DAY
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].t <= cutoff) return samples[i]
  }
  return null
}

const g3 = (n: number) => n.toFixed(3)

// ── detectors ───────────────────────────────────────────────────────────────

/** in-progress · fermenting >= 4d · gravity flat over >= 2d · still >10pts above FG. */
export function detectStuckFermentation(ctx: InsightContext): Insight[] {
  const out: Insight[] = []
  for (const b of ctx.batches) {
    if (b.status !== 'in-progress') continue

    const fermentDays = daysSince(dateOf(b), ctx.now)
    if (fermentDays === null || fermentDays < STUCK_MIN_FERMENT_DAYS) continue

    const fg = targetFG(b)
    if (fg === undefined) continue // guard: can't call "above FG" without a target

    const samples = gravitySamples(ctx.readingsByBatch[b.id])
    if (samples.length < 2) continue // guard: no trend without >= 2 readings

    const latest = samples[samples.length - 1]
    const prior = priorAtLeastDaysBefore(samples, latest.t, STUCK_SPAN_DAYS)
    if (!prior) continue // guard: readings don't span >= 2 days -> not enough evidence

    const drop = prior.gravity - latest.gravity
    const aboveFG = latest.gravity - fg
    if (drop >= STUCK_MIN_DROP) continue // still dropping -> not stuck
    if (aboveFG <= STUCK_ABOVE_FG) continue // near/at FG -> not stuck (ready owns this)

    const severity: InsightSeverity = aboveFG >= STUCK_URGENT_ABOVE_FG ? 'urgent' : 'warn'
    const label = b.name || `Batch #${b.batchNo}`
    const days = Math.floor(fermentDays)
    const points = Math.round(aboveFG * 1000)
    out.push({
      id: `stuck_fermentation:${b.id}`,
      kind: 'stuck_fermentation',
      severity,
      title: `${label} may be stuck at ${g3(latest.gravity)}`,
      detail: `Gravity has held near ${g3(latest.gravity)} for ${days}+ days, still ${points} points above the ${g3(fg)} target FG.`,
      relatedType: 'batch',
      relatedId: b.id,
      ask: `My ${label} has been stuck around ${g3(latest.gravity)} for ${days} days (target FG ${g3(fg)}) — what should I do to restart fermentation?`,
      at: latest.at,
    })
  }
  return out
}

/** in-progress · latest gravity <= FG + 2pts · stable (< 2pt drop) over >= 2d. */
export function detectReadyToPackage(ctx: InsightContext): Insight[] {
  const out: Insight[] = []
  for (const b of ctx.batches) {
    if (b.status !== 'in-progress') continue

    const fg = targetFG(b)
    if (fg === undefined) continue // guard: no target FG -> can't say "at FG"

    const samples = gravitySamples(ctx.readingsByBatch[b.id])
    if (samples.length < 2) continue // guard

    const latest = samples[samples.length - 1]
    if (latest.gravity > fg + READY_NEAR_FG) continue // not at/near FG yet

    const prior = priorAtLeastDaysBefore(samples, latest.t, READY_STABLE_DAYS)
    if (!prior) continue // guard: not stable across a >= 2-day span yet

    const drop = prior.gravity - latest.gravity
    if (drop >= READY_STABLE_DROP) continue // still dropping through FG -> wait

    const label = b.name || `Batch #${b.batchNo}`
    out.push({
      id: `ready_to_package:${b.id}`,
      kind: 'ready_to_package',
      severity: 'info',
      title: `${label} is ready to cold-crash`,
      detail: `Gravity has been stable at ${g3(latest.gravity)} (target FG ${g3(fg)}) for 2+ days — ready to cold-crash / package.`,
      relatedType: 'batch',
      relatedId: b.id,
      ask: `My ${label} has been stable at ${g3(latest.gravity)} (target FG ${g3(fg)}) for a couple days — is it ready to cold-crash and package?`,
      at: latest.at,
    })
  }
  return out
}

/** inventory hops past the cold-storage freshness band (reuse `hopAge`). */
export function detectAgingHops(ctx: InsightContext): Insight[] {
  const out: Insight[] = []
  for (const item of ctx.inventory) {
    const age = hopAge(item, ctx.now) // null for non-hop / undated -> skipped
    if (!age) continue
    if (age.state === 'fresh') continue

    const months = Math.round(age.months)
    const severity: InsightSeverity = age.state === 'old' ? 'warn' : 'info'
    const advice =
      age.state === 'old'
        ? 'Alpha acids have likely faded — use for aroma/dry-hop soon or replace.'
        : 'Use soon and vacuum-seal / keep frozen to slow alpha-acid loss.'
    out.push({
      id: `aging_hops:${item.id}`,
      kind: 'aging_hops',
      severity,
      title: `${item.name} hops are ${age.state} (~${months} mo)`,
      detail: `Purchased ~${months} months ago. ${advice}`,
      relatedType: 'inventory',
      relatedId: item.id,
      ask: `My ${item.name} hops are about ${months} months old — how should I use or store them before they fade?`,
      at: item.purchaseDate,
    })
  }
  return out
}

/** inventory at/below low-stock threshold OR below par (reuse `isLowStock` + par). */
export function detectLowStock(ctx: InsightContext): Insight[] {
  const out: Insight[] = []
  for (const item of ctx.inventory) {
    const belowThreshold = isLowStock(item) // amount <= lowStockThreshold (report logic)
    const belowPar = item.parLevel !== undefined && item.amount < item.parLevel
    if (!belowThreshold && !belowPar) continue

    const target = item.parLevel ?? item.lowStockThreshold
    const severity: InsightSeverity = item.amount <= 0 ? 'urgent' : 'warn'
    const targetStr = target !== undefined ? ` (target ${target}${item.amountUnit})` : ''
    const headline = item.amount <= 0 ? `Out of ${item.name}` : `Low on ${item.name}`
    out.push({
      id: `low_stock:${item.id}`,
      kind: 'low_stock',
      severity,
      title: headline,
      detail: `${item.amount}${item.amountUnit} on hand${targetStr} — restock before your next brew.`,
      relatedType: 'inventory',
      relatedId: item.id,
      ask: `I'm ${item.amount <= 0 ? 'out of' : 'low on'} ${item.name} — how much should I reorder, and what can I substitute in the meantime?`,
      at: item.updatedAt,
    })
  }
  return out
}

/** in-stock yeast lot at/approaching the direct-pitch viability floor → use it or
 *  step it up (warn in the band above the floor, urgent below it). */
export function detectYeastLowViability(ctx: InsightContext): Insight[] {
  const out: Insight[] = []
  const warnAt = VIABILITY_FLOOR_PCT + VIABILITY_WARN_BAND_PCT
  for (const lot of ctx.yeastLots ?? []) {
    if (!isInStock(lot)) continue
    const v = currentViability(lot, ctx.now)
    if (v > warnAt) continue
    const pct = Math.round(v)
    // Decide below/above-floor from the DISPLAYED (rounded) value so the number
    // and the wording can never contradict (e.g. "~50% est." tagged "below floor").
    const belowFloor = pct < VIABILITY_FLOOR_PCT
    out.push({
      id: `yeast_low_viability:${lot.id}`,
      kind: 'yeast_low_viability',
      severity: belowFloor ? 'urgent' : 'warn',
      title: belowFloor
        ? `${lot.name} is below pitch viability (~${pct}% est.)`
        : `${lot.name} viability is fading (~${pct}% est.)`,
      detail: belowFloor
        ? `Est. ~${pct}% viable — below the ~${VIABILITY_FLOOR_PCT}% direct-pitch floor. Build a starter to rebuild a healthy pitch, or use fresh yeast.`
        : `Est. ~${pct}% viable — approaching the ~${VIABILITY_FLOOR_PCT}% floor. Brew with it soon or step it up in a starter while it's still strong.`,
      relatedType: 'inventory',
      relatedId: lot.id,
      ask: `My ${lot.name} lot is about ${pct}% viable — should I pitch it directly, build a starter, or replace it?`,
      at: lot.productionDate,
    })
  }
  return out
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { urgent: 0, warn: 1, info: 2 }

/** Parseable epoch-ms of an insight's `at`, or -Infinity (sorts last within tier). */
function recencyMs(i: Insight): number {
  if (!i.at) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(i.at)
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * Run every detector over the injected context and return the insights ranked by
 * severity (urgent > warn > info), then recency (newest signal first), with a
 * stable id tiebreak so the order is fully deterministic. Empty inputs -> `[]`;
 * missing readings / target FG / dates are handled per-detector without throwing.
 */
export function buildInsights(ctx: InsightContext): Insight[] {
  const all = [
    ...detectStuckFermentation(ctx),
    ...detectReadyToPackage(ctx),
    ...detectAgingHops(ctx),
    ...detectLowStock(ctx),
    ...detectYeastLowViability(ctx),
  ]

  return all.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (bySeverity !== 0) return bySeverity
    const byRecency = recencyMs(b) - recencyMs(a) // newer first
    if (byRecency !== 0 && Number.isFinite(byRecency)) return byRecency
    return a.id.localeCompare(b.id)
  })
}
