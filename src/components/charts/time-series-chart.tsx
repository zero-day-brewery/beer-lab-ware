'use client'
import { buildChartModel } from '@/lib/brewing/charts/build-chart-model'
import { nearestByTime } from '@/lib/brewing/charts/nearest'
import type { AxisConfig, RenderSeries, SeriesConfig } from '@/lib/brewing/charts/types'
import { Axis } from './axis'
import { Crosshair } from './crosshair'
import { Gridlines } from './gridlines'
import { Legend, type LegendItem } from './legend'
import { Series } from './series'
import { Tooltip, type TooltipRow } from './tooltip'
import { useChartSize } from './use-chart-size'
import { useCrosshair } from './use-crosshair'

export interface TimeSeriesChartProps {
  series: SeriesConfig[]
  left: AxisConfig
  right?: AxisConfig
  preferredId?: string
  height?: number
  minWidth?: number
  ariaSummary?: string
  emptyLabel?: string
  className?: string
  testId?: string
}

function nearestMark(rs: RenderSeries, t: number) {
  const i = nearestByTime(
    rs.points.map((p) => p.point),
    t,
  )
  return i === null ? undefined : rs.points[i]
}

export function TimeSeriesChart({
  series,
  left,
  right,
  preferredId,
  height = 220,
  minWidth = 0,
  ariaSummary,
  emptyLabel = 'No data yet.',
  className,
  testId,
}: TimeSeriesChartProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height, minWidth })
  // Build the model + crosshair unconditionally (hooks must run every render).
  const model = buildChartModel({ width: Math.max(width, 1), height, series, left, right })
  const crosshair = useCrosshair(model, preferredId ?? series[0]?.id ?? '')

  const hasData = series.some((s) => s.data.length > 0)
  const legendItems: LegendItem[] = series.map((s) => ({
    id: s.id,
    label: s.label,
    color: s.color,
  }))
  const summary = ariaSummary ?? series.map((s) => `${s.label}: ${s.data.length} points`).join('; ')

  if (!hasData) {
    // Keep the same measured container mounted (ref attached) even while empty so
    // the ResizeObserver is already reporting a width when data arrives — a live
    // empty→data transition (e.g. logging the first reading) must swap straight to
    // the chart without waiting for a fresh measurement pass.
    return (
      <div ref={ref} className={`chart-root chart-root--empty ${className ?? ''}`}>
        <Legend items={legendItems} />
        <p className="chart-empty">{emptyLabel}</p>
      </div>
    )
  }

  const primary = model.series.find((s) => s.id === crosshair.primaryId)
  const focus =
    crosshair.active && crosshair.index !== null ? primary?.points[crosshair.index] : undefined
  const crossX = focus ? focus.cx : 0

  const tooltipRows: TooltipRow[] = focus
    ? series.map((s) => {
        const rs = model.series.find((m) => m.id === s.id)
        const near = rs ? nearestMark(rs, focus.point.t) : undefined
        return {
          id: s.id,
          label: s.label,
          value: near ? s.format(near.point.v) : '—',
          color: s.color,
        }
      })
    : []
  const marks = focus
    ? model.series
        .map((rs) => {
          const near = nearestMark(rs, focus.point.t)
          return near ? { id: rs.id, cx: near.cx, cy: near.cy, color: rs.color } : null
        })
        .filter((m): m is { id: string; cx: number; cy: number; color: string } => m !== null)
    : []
  const liveText = focus
    ? `${new Date(focus.point.t).toISOString().slice(0, 16)} — ${tooltipRows
        .map((r) => `${r.label} ${r.value}`)
        .join(', ')}`
    : ''

  return (
    <div ref={ref} className={`chart-root ${className ?? ''}`} style={{ position: 'relative' }}>
      <Legend items={legendItems} />
      {ready ? (
        <>
          <svg
            className="chart-svg"
            data-testid={testId}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={summary}
          >
            <g transform={`translate(${model.inner.x},${model.inner.y})`}>
              <Gridlines ticks={model.leftTicks} width={model.inner.width} />
              <Axis
                orientation="left"
                ticks={model.leftTicks}
                length={model.inner.height}
                label={left.label}
              />
              {right && (
                <g transform={`translate(${model.inner.width},0)`}>
                  <Axis
                    orientation="right"
                    ticks={model.rightTicks}
                    length={model.inner.height}
                    label={right.label}
                  />
                </g>
              )}
              <g transform={`translate(0,${model.inner.height})`}>
                <Axis orientation="bottom" ticks={model.xTicks} length={model.inner.width} />
              </g>
              {model.series.map((s) => (
                <Series key={s.id} series={s} />
              ))}
              {crosshair.active && focus && (
                <Crosshair x={crossX} height={model.inner.height} marks={marks} />
              )}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: intentional keyboard+pointer capture surface — aria-label provided; role="slider" deliberately omitted per E4 spec */}
              <rect
                className="chart-capture"
                x={0}
                y={0}
                width={model.inner.width}
                height={model.inner.height}
                fill="transparent"
                tabIndex={0}
                aria-label={`${summary}. Use arrow keys to inspect readings.`}
                style={{ touchAction: 'pan-y', outline: 'none' }}
                onPointerMove={crosshair.handlers.onPointerMove}
                onPointerDown={crosshair.handlers.onPointerDown}
                onPointerLeave={crosshair.handlers.onPointerLeave}
                onPointerCancel={crosshair.handlers.onPointerCancel}
                onKeyDown={crosshair.handlers.onKeyDown}
              />
            </g>
          </svg>
          {focus && (
            <Tooltip
              x={model.inner.x + crossX}
              y={model.inner.y + focus.cy}
              width={width}
              title={new Date(focus.point.t).toISOString().slice(0, 16)}
              rows={tooltipRows}
            />
          )}
          <div className="sr-only" aria-live="polite" data-testid="chart-live">
            {liveText}
          </div>
        </>
      ) : (
        <div
          className="chart-skeleton"
          data-testid="chart-skeleton"
          style={{ height }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
