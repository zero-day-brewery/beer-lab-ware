import { apparentAttenuationPct } from '@/lib/brewing/batch/efficiency'
import type { Batch } from '@/lib/brewing/types/batch'

/**
 * Pure trend series over completed batches for the logbook trends view.
 * Each series is sorted ascending by batchNo and drops batches that lack the
 * measurement the series needs. No DOM/Dexie/fetch — render layer owns SVG.
 */
export interface TrendPoint {
  batchNo: number
  date: string
  value: number
}

function byBatchNoAsc(a: Batch, b: Batch): number {
  return a.batchNo - b.batchNo
}

function dateOf(b: Batch): string {
  return b.brewedAt ?? b.startedAt
}

export function efficiencyTrend(batches: Batch[]): TrendPoint[] {
  return [...batches]
    .sort(byBatchNoAsc)
    .filter((b) => typeof b.results.brewhouseEfficiency_pct === 'number')
    .map((b) => ({
      batchNo: b.batchNo,
      date: dateOf(b),
      value: b.results.brewhouseEfficiency_pct as number,
    }))
}

export function attenuationTrend(batches: Batch[]): TrendPoint[] {
  return [...batches]
    .sort(byBatchNoAsc)
    .filter(
      (b) => typeof b.results.measuredOG === 'number' && typeof b.results.measuredFG === 'number',
    )
    .map((b) => ({
      batchNo: b.batchNo,
      date: dateOf(b),
      value: apparentAttenuationPct(b.results.measuredOG as number, b.results.measuredFG as number),
    }))
}

export function ogFgAccuracyTrend(batches: Batch[]): TrendPoint[] {
  return [...batches]
    .sort(byBatchNoAsc)
    .filter((b) => typeof b.results.measuredOG === 'number')
    .map((b) => ({
      batchNo: b.batchNo,
      date: dateOf(b),
      value: b.results.measuredOG as number,
    }))
}
