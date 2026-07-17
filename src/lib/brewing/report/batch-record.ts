import {
  formatAmount,
  formatWithUnit,
  kindForMetricUnit,
  unitLabel,
} from '@/lib/brewing/convert/display-units'
import type { Batch, LogEntry } from '@/lib/brewing/types/batch'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Units } from '@/lib/brewing/types/settings'
import type { BatchCostLine, BatchCostReport } from './batch-cost'
import type { ReportColumn } from './columns'

/**
 * Completed-batch record — the pure read-model behind the per-batch Excel
 * export. Flattens a `Batch` (metadata, timeline logs, results vs computed
 * targets, tasting) plus its readings and COGS report into sheet-ready rows.
 * Display values honor the units preference via the display-units layer;
 * storage stays canonical metric.
 */

export interface BatchRecordKV {
  label: string
  value: string
}

export interface TargetActualRow {
  metric: string
  target: string
  actual: string
}

export interface BatchRecord {
  title: string
  subtitle: string
  generatedAtISO: string
  batchNo: number
  meta: BatchRecordKV[]
  targetsVsActuals: TargetActualRow[]
  logs: LogEntry[]
  readings: Reading[]
  tasting: BatchRecordKV[]
  cost: BatchCostReport
  units: Units
}

export interface BuildBatchRecordInput {
  batch: Batch
  readings: Reading[]
  cost: BatchCostReport
  units: Units
  generatedAt: Date
}

const EMDASH = '—'

const fmtDate = (iso?: string): string => (iso ? iso.slice(0, 10) : '')
const fmtMoney = (n: number | null): string => (n === null ? EMDASH : `$${n.toFixed(2)}`)
const titleCase = (s: string): string =>
  s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** A log/target value: convert canonical-metric numbers (L, °C, kg, L/kg) to
 *  the display units; leave strings, booleans, and unconvertible units alone. */
function fmtLogValue(
  value: LogEntry['value'] | undefined,
  unit: string | undefined,
  units: Units,
): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  const kind = kindForMetricUnit(unit)
  if (kind) return formatWithUnit(value, kind, units)
  return unit ? `${value} ${unit}` : String(value)
}

export function buildBatchRecord(input: BuildBatchRecordInput): BatchRecord {
  const { batch, readings, cost, units, generatedAt } = input
  const t = batch.computedTargets
  const r = batch.results
  const volUnit = unitLabel('volume', units)
  const vol = (l: number | undefined): string =>
    l === undefined ? EMDASH : formatAmount(l, 'volume', units)

  const meta: BatchRecordKV[] = [
    { label: 'Batch #', value: String(batch.batchNo) },
    { label: 'Name', value: batch.name },
    { label: 'Status', value: batch.status },
    ...(batch.recipeSnapshot ? [{ label: 'Recipe', value: batch.recipeSnapshot.name }] : []),
    { label: 'Started', value: fmtDate(batch.startedAt) },
    ...(batch.brewedAt ? [{ label: 'Brewed', value: fmtDate(batch.brewedAt) }] : []),
    ...(batch.completedAt ? [{ label: 'Completed', value: fmtDate(batch.completedAt) }] : []),
    ...(batch.waterSourceName ? [{ label: 'Water source', value: batch.waterSourceName }] : []),
  ]

  const row = (
    metric: string,
    target: string | undefined,
    actual: string | undefined,
  ): TargetActualRow | null =>
    target === undefined && actual === undefined
      ? null
      : { metric, target: target ?? EMDASH, actual: actual ?? EMDASH }

  const targetsVsActuals = [
    row('OG', t?.OG.toFixed(3), r.measuredOG?.toFixed(3)),
    row('FG', t?.FG.toFixed(3), r.measuredFG?.toFixed(3)),
    row(
      'ABV',
      t && `${t.ABV.toFixed(2)}%`,
      r.measuredABV !== undefined ? `${r.measuredABV.toFixed(2)}%` : undefined,
    ),
    row('IBU', t?.IBU.toFixed(0), undefined),
    row('SRM', t?.SRM.toFixed(1), undefined),
    row(
      `Pre-boil (${volUnit})`,
      t && vol(t.volumes.preBoilVolume_L),
      r.preBoilVolume_L !== undefined ? vol(r.preBoilVolume_L) : undefined,
    ),
    row(
      `Into fermenter (${volUnit})`,
      t && vol(t.volumes.intoFermenter_L),
      r.intoFermenter_L !== undefined ? vol(r.intoFermenter_L) : undefined,
    ),
    row(
      'Mash pH',
      batch.estMashPh?.toFixed(2),
      batch.measuredMashPh !== undefined ? batch.measuredMashPh.toFixed(2) : undefined,
    ),
    row(
      'Mash efficiency',
      undefined,
      r.mashEfficiency_pct !== undefined ? `${r.mashEfficiency_pct.toFixed(1)}%` : undefined,
    ),
    row(
      'Apparent attenuation',
      undefined,
      r.apparentAttenuation_pct !== undefined
        ? `${r.apparentAttenuation_pct.toFixed(1)}%`
        : undefined,
    ),
  ].filter((x): x is TargetActualRow => x !== null)

  const tastingNotes: Array<[string, string | undefined]> = [
    ['Aroma', batch.tasting?.aroma_md],
    ['Appearance', batch.tasting?.appearance_md],
    ['Flavor', batch.tasting?.flavor_md],
    ['Mouthfeel', batch.tasting?.mouthfeel_md],
    ['Overall', batch.tasting?.overall_md],
  ]
  const tasting: BatchRecordKV[] = [
    ...(batch.tasting?.rating !== undefined
      ? [{ label: 'Rating', value: `${batch.tasting.rating} / 5` }]
      : []),
    ...tastingNotes
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([label, value]) => ({ label, value })),
    ...(batch.tasting?.bjcp
      ? [{ label: 'BJCP total', value: `${batch.tasting.bjcp.total} / 50` }]
      : []),
  ]

  return {
    title: 'Beer-Lab-Ware',
    subtitle: `Batch Record — #${batch.batchNo} · ${batch.name}`,
    generatedAtISO: generatedAt.toISOString(),
    batchNo: batch.batchNo,
    meta,
    targetsVsActuals,
    logs: [...batch.logs].sort((a, b) => a.at.localeCompare(b.at)),
    readings: [...readings].sort((a, b) => a.at.localeCompare(b.at)),
    tasting,
    cost,
    units,
  }
}

export function batchRecordFilename(record: BatchRecord): string {
  return `beer-lab-ware-batch-${record.batchNo}-record-${record.generatedAtISO.slice(0, 10)}.xlsx`
}

/** Timeline sheet columns. Values honor the units preference (canonical-L/°C
 *  log values convert; free-text and unconvertible units pass through). */
export function batchLogColumns(units: Units): ReportColumn<LogEntry>[] {
  return [
    { header: 'Time (ISO)', get: (l) => l.at, width: 24 },
    { header: 'Step', get: (l) => l.stepId, width: 16 },
    { header: 'Entry', get: (l) => l.label, width: 24 },
    { header: 'Value', get: (l) => fmtLogValue(l.value, l.unit, units), width: 18 },
    { header: 'Target', get: (l) => fmtLogValue(l.target, l.unit, units), width: 18 },
  ]
}

/** Readings sheet columns — ISO timestamps; temperature honors display units. */
export function batchReadingColumns(units: Units): ReportColumn<Reading>[] {
  return [
    { header: 'Time (ISO)', get: (r) => r.at, width: 24 },
    { header: 'Gravity (SG)', get: (r) => (r.gravity === undefined ? '' : r.gravity.toFixed(3)) },
    {
      header: `Temp (${unitLabel('temp', units)})`,
      get: (r) => (r.tempC === undefined ? '' : formatAmount(r.tempC, 'temp', units)),
    },
    { header: 'pH', get: (r) => (r.ph === undefined ? '' : r.ph.toFixed(2)), width: 8 },
    { header: 'Note', get: (r) => r.note ?? '', width: 40 },
  ]
}

/** Cost sheet columns — explicit USD; unpriced cells render an em-dash, never a guess. */
export const BATCH_COST_COLUMNS: ReportColumn<BatchCostLine>[] = [
  { header: 'Item', get: (l) => l.itemName, width: 28 },
  { header: 'Kind', get: (l) => titleCase(l.kind), width: 16 },
  { header: 'Qty', get: (l) => String(l.qty), width: 10 },
  { header: 'Unit', get: (l) => l.unit, width: 8 },
  { header: 'Unit Price (USD)', get: (l) => fmtMoney(l.unitPrice), width: 16 },
  { header: 'Cost (USD)', get: (l) => fmtMoney(l.cost), width: 14 },
]
