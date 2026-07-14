'use client'
import { useMemo } from 'react'
import {
  attenuationTrend,
  efficiencyTrend,
  ogFgAccuracyTrend,
  type TrendPoint,
} from '@/lib/brewing/batch/trends'
import type { Batch } from '@/lib/brewing/types/batch'
import { useBatchesStore } from '@/stores/batches-store'

/** Pure: turn a value series into an SVG path string scaled to w×h.
 *  Single point → a flat midline (no divide-by-zero). */
export function sparklinePath(values: number[], w: number, h: number): string {
  if (values.length === 0) return ''
  if (values.length === 1) return `M0,${(h / 2).toFixed(1)} L${w},${(h / 2).toFixed(1)}`
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = w / (values.length - 1)
  return values
    .map((v, i) => {
      const x = i * stepX
      const y = h - ((v - min) / span) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function Sparkline({ title, unit, points }: { title: string; unit: string; points: TrendPoint[] }) {
  const values = points.map((p) => p.value)
  const last = values.at(-1)
  return (
    <div className="trend-card">
      <div className="trend-card-head">
        <span className="trend-title">{title}</span>
        <span className="trend-last">{last === undefined ? '—' : `${last.toFixed(1)}${unit}`}</span>
      </div>
      <svg
        className="trend-spark"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        <path className="trend-spark-line" d={sparklinePath(values, 100, 24)} fill="none" />
      </svg>
      <div className="trend-axis">
        <span>#{points[0]?.batchNo ?? '—'}</span>
        <span>#{points.at(-1)?.batchNo ?? '—'}</span>
      </div>
    </div>
  )
}

export function TrendsView() {
  const { batches, isLoading } = useBatchesStore()
  const series = useMemo(() => {
    const list = batches as Batch[]
    return {
      eff: efficiencyTrend(list),
      att: attenuationTrend(list),
      acc: ogFgAccuracyTrend(list),
    }
  }, [batches])

  if (isLoading) return <p className="trend-empty">Loading…</p>

  return (
    <div className="trend-grid">
      <Sparkline title="Brewhouse efficiency" unit="%" points={series.eff} />
      <Sparkline title="Apparent attenuation" unit="%" points={series.att} />
      <Sparkline title="OG/FG accuracy" unit="" points={series.acc} />
    </div>
  )
}
