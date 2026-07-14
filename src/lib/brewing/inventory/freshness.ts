/**
 * Inventory freshness & value intelligence — pure, portable brewing logic.
 *
 * No DOM, no Dexie, no `fetch`. Mirrors the pure-aggregator pattern of
 * `report/inventory-report.ts`: a dumb view feeds items + `now` in and gets
 * plain data out via `useMemo`. Keep it side-effect free so it stays portable
 * to a native iOS calc engine later (see project CLAUDE.md conventions).
 *
 * ── Models & citations ────────────────────────────────────────────────────
 *
 * Freshness bands (`itemFreshness`): best-by is authoritative. An item is
 *   `expired` once past its best-by date, `aging` inside the last 30 days
 *   before best-by, and separately `aging` once an opened package has been
 *   open longer than 60 days (staling of an opened ingredient). The 30-day
 *   warning window and 60-day opened-shelf window are homebrew rules of thumb,
 *   not lab constants — they exist to nudge use-it-soon, not to condemn stock.
 *
 * Liquid-yeast viability (`yeastViability`): liquid yeast loses viability with
 *   age from packaging. White Labs / Wyeast and the widely-used Mr. Malty /
 *   "Yeast" (Zainasheff & White, 2010) pitch-rate model treat a liquid pack as
 *   ~97–100% viable at manufacture and losing ~21–25% per month (~0.7%/day)
 *   in cold storage. We model **97% start − 0.7%/day**, clamped to 0–100, and
 *   use `purchaseDate` as a proxy for the manufacture date (we don't track a
 *   separate mfg date), so the UI always labels the number "est." Dry yeast is
 *   far more stable, but we apply the same conservative curve to any yeast row
 *   with a date rather than over-claim.
 *   Refs: Zainasheff & White, "Yeast" (Brewers Publications, 2010);
 *   Mr. Malty pitch-rate calculator viability model (mrmalty.com).
 *
 * Hop age (`hopAge`): alpha-acid degradation is slow when hops are kept cold in
 *   oxygen-barrier packaging. Cold-storage homebrew heuristic: <6 months
 *   `fresh`, 6–12 months `aging`, >12 months `old` (meaningful alpha loss even
 *   frozen). Uses `purchaseDate` as the reference. Ref: Hieronymus, "For the
 *   Love of Hops" (2012), cold-storage hop stability guidance.
 */

import { type InventoryItem, isLowStock } from '@/lib/brewing/types/inventory'

const MS_PER_DAY = 86_400_000
/** Mean Gregorian month length (365.25 / 12) — for month-scale hop age. */
const DAYS_PER_MONTH = 30.4375

/** Best-by warning window: `aging` when this close to (or past) best-by. */
const BEST_BY_WARN_DAYS = 30
/** Opened-package staling window: `aging` once open longer than this. */
const OPENED_STALE_DAYS = 60

/** Liquid-yeast viability model (see module doc for citation). */
const YEAST_START_VIABILITY_PCT = 97
const YEAST_LOSS_PCT_PER_DAY = 0.7

export type FreshnessState = 'fresh' | 'aging' | 'expired'

export interface ItemFreshness {
  state: FreshnessState
  reason?: string
}

export type HopAgeState = 'fresh' | 'aging' | 'old'

export interface HopAge {
  months: number
  state: HopAgeState
}

export interface ShoppingLine {
  item: InventoryItem
  /** target − amount (always > 0 for a line to exist). */
  deficit: number
  /** deficit × pricePerUnit_USD (0 when no price is known). */
  estCost: number
}

export interface InventoryStats {
  itemCount: number
  totalValue_USD: number
  lowStockCount: number
  /** items whose freshness is `aging` or `expired`. */
  expiringSoonCount: number
  shopping: ShoppingLine[]
}

/** On-hand dollar value of a line: `amount × pricePerUnit` (0 when unpriced). */
export function itemValue(item: InventoryItem): number {
  return item.amount * (item.pricePerUnit_USD ?? 0)
}

/**
 * Freshness state for an item. `expired` past best-by; `aging` within
 * {@link BEST_BY_WARN_DAYS} of best-by OR opened longer than
 * {@link OPENED_STALE_DAYS}; otherwise `fresh`.
 */
export function itemFreshness(item: InventoryItem, now: Date = new Date()): ItemFreshness {
  const nowMs = now.getTime()

  if (item.bestByDate) {
    const bestByMs = new Date(item.bestByDate).getTime()
    if (bestByMs < nowMs) {
      return { state: 'expired', reason: `Past best-by ${item.bestByDate.slice(0, 10)}` }
    }
    const daysLeft = (bestByMs - nowMs) / MS_PER_DAY
    if (daysLeft <= BEST_BY_WARN_DAYS) {
      return { state: 'aging', reason: `Best-by in ${Math.ceil(daysLeft)} d` }
    }
  }

  if (item.status === 'opened' && item.openedDate) {
    const daysOpen = (nowMs - new Date(item.openedDate).getTime()) / MS_PER_DAY
    if (daysOpen > OPENED_STALE_DAYS) {
      return { state: 'aging', reason: `Opened ${Math.floor(daysOpen)} d ago` }
    }
  }

  return { state: 'fresh' }
}

/**
 * Estimated liquid-yeast viability % (0–100), or `null` for non-yeast rows or
 * yeast without a `purchaseDate`. Model: 97% at packaging − 0.7%/day, clamped.
 * See module doc for citation. UI must label the result "est."
 */
export function yeastViability(item: InventoryItem, now: Date = new Date()): number | null {
  if (item.ingredientKind !== 'yeast' || !item.purchaseDate) return null
  const days = (now.getTime() - new Date(item.purchaseDate).getTime()) / MS_PER_DAY
  const raw = YEAST_START_VIABILITY_PCT - YEAST_LOSS_PCT_PER_DAY * days
  return Math.max(0, Math.min(100, raw))
}

/**
 * Hop age in months + a cold-storage freshness band, or `null` for non-hop
 * rows or hops without a `purchaseDate`. <6mo fresh, 6–12 aging, >12 old.
 */
export function hopAge(item: InventoryItem, now: Date = new Date()): HopAge | null {
  if (item.ingredientKind !== 'hop' || !item.purchaseDate) return null
  const days = (now.getTime() - new Date(item.purchaseDate).getTime()) / MS_PER_DAY
  const months = days / DAYS_PER_MONTH
  const state: HopAgeState = months < 6 ? 'fresh' : months <= 12 ? 'aging' : 'old'
  return { months, state }
}

/**
 * Aggregate pantry stats + a par-driven shopping list. Pure roll-up over the
 * item list — value never touches a single item's UI, and counts mirror the
 * report's meaning (low-stock via {@link isLowStock}, expiring via
 * {@link itemFreshness}). A shopping line exists when
 * `amount < (parLevel ?? lowStockThreshold ?? 0)`.
 */
export function buildInventoryStats(
  items: InventoryItem[],
  now: Date = new Date(),
): InventoryStats {
  let totalValue_USD = 0
  let lowStockCount = 0
  let expiringSoonCount = 0
  const shopping: ShoppingLine[] = []

  for (const item of items) {
    totalValue_USD += itemValue(item)
    if (isLowStock(item)) lowStockCount += 1

    const { state } = itemFreshness(item, now)
    if (state === 'aging' || state === 'expired') expiringSoonCount += 1

    const target = item.parLevel ?? item.lowStockThreshold ?? 0
    if (item.amount < target) {
      const deficit = target - item.amount
      shopping.push({ item, deficit, estCost: deficit * (item.pricePerUnit_USD ?? 0) })
    }
  }

  return {
    itemCount: items.length,
    totalValue_USD,
    lowStockCount,
    expiringSoonCount,
    shopping,
  }
}
