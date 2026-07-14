'use client'
import type { AxisConfig, SeriesConfig, SeriesPoint } from '@/lib/brewing/charts/types'
import { cToF } from '@/lib/brewing/convert/temp'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Units } from '@/lib/brewing/types/settings'
import { TimeSeriesChart } from './time-series-chart'

function toPoints(readings: Reading[], pick: (r: Reading) => number | undefined): SeriesPoint[] {
  return readings
    .map((r) => ({ t: Date.parse(r.at), v: pick(r) }))
    .filter((p): p is SeriesPoint => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t)
}

export function FermentationChart({
  readings,
  units,
  height = 220,
}: {
  readings: Reading[]
  units: Units
  height?: number
}) {
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  // CALLER converts °C → display units before the pure builders ever see a value.
  const toDisplayTemp = (c: number) => (units === 'imperial' ? cToF(c) : c)

  const series: SeriesConfig[] = [
    {
      id: 'gravity',
      label: 'Gravity',
      data: toPoints(readings, (r) => r.gravity),
      axis: 'left',
      color: 'var(--wort, var(--malt))',
      area: true,
      format: (v) => v.toFixed(3),
    },
    {
      id: 'temp',
      label: `Temp ${tempUnit}`,
      data: toPoints(readings, (r) => (r.tempC === undefined ? undefined : toDisplayTemp(r.tempC))),
      axis: 'right',
      color: 'var(--primary)',
      format: (v) => `${Math.round(v)}${tempUnit}`,
    },
  ]

  const left: AxisConfig = { label: 'Gravity', ticks: 5, nice: true, format: (v) => v.toFixed(3) }
  const right: AxisConfig = {
    label: `Temp ${tempUnit}`,
    ticks: 5,
    nice: true,
    format: (v) => `${Math.round(v)}${tempUnit}`,
  }

  return (
    <TimeSeriesChart
      series={series}
      left={left}
      right={right}
      preferredId="gravity"
      height={height}
      testId="fermentation-chart"
      ariaSummary="Fermentation gravity and temperature over time"
      emptyLabel="Log a reading to start the fermentation curve."
      className="ferment-chart-kit"
    />
  )
}
