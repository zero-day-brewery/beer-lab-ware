/**
 * Display-unit conversion layer — the ONE place canonical metric values are
 * turned into user-facing quantities (and parsed back) per the Settings units
 * preference. STORAGE STAYS CANONICAL METRIC: every persisted value (Dexie
 * rows, dumps, recipes, readings) is L / kg / g / °C; these helpers convert at
 * the input/output boundary only, exactly like the readings tempC ↔ °F
 * precedent in batch-sheet-view.
 *
 * Pure module — no React, no stores. Components get the active `Units` from
 * `useDisplayUnits()` (src/hooks/use-display-units.ts) and pass it in.
 */

import type { Units } from '@/lib/brewing/types/settings'
import { gToOz, kgToLb, lbToKg, ozToG } from './mass'
import { cToF, fToC } from './temp'
import { galToL, lToGal } from './volume'

/**
 * What a number MEANS, so the right imperial unit is chosen:
 *   volume      batch / boil / water / vessel volumes    L    ↔ gal
 *   volume-rate per-hour volumes (evaporation)           L/hr ↔ gal/hr
 *   mass-grain  fermentable / grain masses               kg   ↔ lb
 *   mass-hop    hop & other small-ingredient masses      g    ↔ oz
 *   temp        temperatures                             °C   ↔ °F
 *   mash-ratio  mash thickness / grain absorption        L/kg ↔ qt/lb
 */
export type QuantityKind =
  | 'volume'
  | 'volume-rate'
  | 'mass-grain'
  | 'mass-hop'
  | 'temp'
  | 'mash-ratio'

const QT_PER_GAL = 4

/** 1 L/kg in qt/lb, derived from the volume+mass primitives (single source of truth). */
const lPerKgToQtPerLb = (r: number): number => (lToGal(r) * QT_PER_GAL) / kgToLb(1)
const qtPerLbToLPerKg = (r: number): number => galToL(r / QT_PER_GAL) * kgToLb(1)

const LABELS: Record<QuantityKind, { metric: string; imperial: string }> = {
  volume: { metric: 'L', imperial: 'gal' },
  'volume-rate': { metric: 'L/hr', imperial: 'gal/hr' },
  'mass-grain': { metric: 'kg', imperial: 'lb' },
  'mass-hop': { metric: 'g', imperial: 'oz' },
  temp: { metric: '°C', imperial: '°F' },
  'mash-ratio': { metric: 'L/kg', imperial: 'qt/lb' },
}

/** Decimal places used when seeding an INPUT — enough precision to round-trip. */
const INPUT_DP: Record<QuantityKind, number> = {
  volume: 3,
  'volume-rate': 3,
  'mass-grain': 3,
  'mass-hop': 2,
  temp: 1,
  'mash-ratio': 2,
}

/** Default decimal places for READ-ONLY rendering, chosen to match what the
 *  metric UI already showed (volumes .toFixed(2), grain .toFixed(3), …). */
const DISPLAY_DP: Record<QuantityKind, { metric: number; imperial: number }> = {
  volume: { metric: 2, imperial: 2 },
  'volume-rate': { metric: 1, imperial: 2 },
  'mass-grain': { metric: 3, imperial: 2 },
  'mass-hop': { metric: 1, imperial: 2 },
  temp: { metric: 1, imperial: 1 },
  'mash-ratio': { metric: 2, imperial: 2 },
}

/**
 * Max |parse(format(x)) − x| in CANONICAL units — the half-ULP of INPUT_DP in
 * the coarser of the two unit systems. Used by the round-trip property test
 * and by UnitNumberInput to tell "formatting noise" from a real external edit.
 */
export const CANONICAL_EPSILON: Record<QuantityKind, number> = {
  volume: 0.002,
  'volume-rate': 0.002,
  'mass-grain': 0.001,
  'mass-hop': 0.15,
  temp: 0.06,
  'mash-ratio': 0.02,
}

/** The unit label the user sees for this kind under the given unit system. */
export function unitLabel(kind: QuantityKind, units: Units): string {
  return LABELS[kind][units]
}

/** Canonical metric → display value. Metric mode is the identity. */
export function toDisplay(canonical: number, kind: QuantityKind, units: Units): number {
  if (units === 'metric') return canonical
  switch (kind) {
    case 'volume':
    case 'volume-rate':
      return lToGal(canonical)
    case 'mass-grain':
      return kgToLb(canonical)
    case 'mass-hop':
      return gToOz(canonical)
    case 'temp':
      return cToF(canonical)
    case 'mash-ratio':
      return lPerKgToQtPerLb(canonical)
  }
}

/** Display value → canonical metric. Inverse of {@link toDisplay}. */
export function fromDisplay(display: number, kind: QuantityKind, units: Units): number {
  if (units === 'metric') return display
  switch (kind) {
    case 'volume':
    case 'volume-rate':
      return galToL(display)
    case 'mass-grain':
      return lbToKg(display)
    case 'mass-hop':
      return ozToG(display)
    case 'temp':
      return fToC(display)
    case 'mash-ratio':
      return qtPerLbToLPerKg(display)
  }
}

/**
 * Canonical → input-seed string: converted, rounded at the kind's input
 * precision, trailing zeros trimmed ("19", "5.019"). parse(formatForInput(x))
 * is within CANONICAL_EPSILON[kind] of x — tested as an explicit property.
 */
export function formatForInput(canonical: number, kind: QuantityKind, units: Units): string {
  return String(Number(toDisplay(canonical, kind, units).toFixed(INPUT_DP[kind])))
}

/** User input text → canonical metric, or null for empty / non-numeric text. */
export function parseInput(text: string, kind: QuantityKind, units: Units): number | null {
  if (text.trim() === '') return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  return fromDisplay(n, kind, units)
}

/** Canonical → read-only display NUMBER string ("5.28"), no unit label. */
export function formatAmount(
  canonical: number,
  kind: QuantityKind,
  units: Units,
  decimals?: number,
): string {
  return toDisplay(canonical, kind, units).toFixed(decimals ?? DISPLAY_DP[kind][units])
}

/** Canonical → read-only "value unit" string ("5.28 gal", "67.0 °C"). */
export function formatWithUnit(
  canonical: number,
  kind: QuantityKind,
  units: Units,
  decimals?: number,
): string {
  return `${formatAmount(canonical, kind, units, decimals)} ${unitLabel(kind, units)}`
}

/**
 * Guided-flow value tokens carry a metric unit label ('L', '°C', …). Map the
 * CONVERTIBLE labels to a kind; everything else (psi, min, %, vol, B — and
 * deliberately 'g': salt/yeast grams are the brewing convention even in
 * imperial recipes) returns null → render untouched.
 */
export function kindForMetricUnit(metricUnit: string | undefined): QuantityKind | null {
  switch (metricUnit) {
    case 'L':
      return 'volume'
    case '°C':
      return 'temp'
    case 'kg':
      return 'mass-grain'
    case 'L/kg':
      return 'mash-ratio'
    default:
      return null
  }
}
