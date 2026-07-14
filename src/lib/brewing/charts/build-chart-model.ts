import { scaleLinear, scaleTime } from 'd3-scale'
import { area as buildArea, line as buildLine, curveMonotoneX } from 'd3-shape'
import type {
  AxisConfig,
  ChartMargin,
  ChartModel,
  ChartModelInput,
  RenderSeries,
  SeriesConfig,
  SeriesPoint,
  Tick,
} from './types'

const DEFAULT_MARGIN: ChartMargin = { top: 12, right: 52, bottom: 28, left: 52 }
const X_TICK_COUNT = 5

/** Format an epoch-ms instant as a stable, timezone-independent tick label.
 *  toISOString is always UTC, so labels never shift with the host TZ. */
function formatUtcTick(t: number, spanMs: number): string {
  const iso = new Date(t).toISOString() // YYYY-MM-DDTHH:mm:ss.sssZ
  // Under 2 days → HH:mm; longer spans → MM-DD.
  return spanMs < 2 * 86_400_000 ? iso.slice(11, 16) : iso.slice(5, 10)
}

/** Union time-extent across every series' finite points. */
function timeExtent(series: SeriesConfig[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const s of series) {
    for (const p of s.data) {
      if (!Number.isFinite(p.t)) continue
      if (p.t < lo) lo = p.t
      if (p.t > hi) hi = p.t
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  return [lo, hi]
}

/** Value-extent for the series on one axis, with flat-guard + fractional pad. */
function valueExtent(
  series: SeriesConfig[],
  axis: 'left' | 'right',
  cfg: AxisConfig,
): [number, number] {
  if (cfg.domain) return cfg.domain
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const s of series) {
    if (s.axis !== axis) continue
    for (const p of s.data) {
      if (!Number.isFinite(p.v)) continue
      if (p.v < lo) lo = p.v
      if (p.v > hi) hi = p.v
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (lo === hi) {
    const band = lo === 0 ? 1 : Math.abs(lo) * 0.05
    lo -= band
    hi += band
  }
  const pad = (cfg.pad ?? 0.05) * (hi - lo)
  return [lo - pad, hi + pad]
}

export function buildChartModel(input: ChartModelInput): ChartModel {
  const margin = input.margin ?? DEFAULT_MARGIN
  const inner = {
    x: margin.left,
    y: margin.top,
    width: Math.max(0, input.width - margin.left - margin.right),
    height: Math.max(0, input.height - margin.top - margin.bottom),
  }

  const [t0, t1] = timeExtent(input.series)
  const spanMs = t1 - t0
  const x = scaleTime().domain([t0, t1]).range([0, inner.width])

  const leftScale = scaleLinear()
    .domain(valueExtent(input.series, 'left', input.left))
    .range([inner.height, 0])
  if (input.left.nice ?? true) leftScale.nice(input.left.ticks ?? 5)

  const rightCfg = input.right
  const rightScale = rightCfg
    ? scaleLinear()
        .domain(valueExtent(input.series, 'right', rightCfg))
        .range([inner.height, 0])
    : null
  if (rightScale && rightCfg && (rightCfg.nice ?? true)) rightScale.nice(rightCfg.ticks ?? 5)

  const xTicks: Tick[] = x.ticks(X_TICK_COUNT).map((d) => {
    const t = d.valueOf()
    return { value: t, offset: x(d), label: formatUtcTick(t, spanMs) }
  })
  const leftTicks: Tick[] = leftScale.ticks(input.left.ticks ?? 5).map((v) => ({
    value: v,
    offset: leftScale(v),
    label: input.left.format(v),
  }))
  const rightTicks: Tick[] =
    rightScale && rightCfg
      ? rightScale.ticks(rightCfg.ticks ?? 5).map((v) => ({
          value: v,
          offset: rightScale(v),
          label: rightCfg.format(v),
        }))
      : []

  const series: RenderSeries[] = input.series.map((s) => {
    const yScale = s.axis === 'right' && rightScale ? rightScale : leftScale
    const lineGen = buildLine<SeriesPoint>()
      .x((p) => x(p.t))
      .y((p) => yScale(p.v))
      .defined((p) => Number.isFinite(p.v))
      .curve(curveMonotoneX)
    const areaGen = buildArea<SeriesPoint>()
      .x((p) => x(p.t))
      .y0(inner.height)
      .y1((p) => yScale(p.v))
      .defined((p) => Number.isFinite(p.v))
      .curve(curveMonotoneX)
    const points = s.data
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .map((point) => ({ cx: x(point.t), cy: yScale(point.v), point }))
    return {
      id: s.id,
      color: s.color,
      axis: s.axis,
      linePath: lineGen(s.data) ?? '',
      areaPath: s.area ? (areaGen(s.data) ?? '') : undefined,
      points,
    }
  })

  return {
    inner,
    xTicks,
    leftTicks,
    rightTicks,
    series,
    xToPx: (t: number) => x(t),
    pxToT: (px: number) => x.invert(px).valueOf(),
  }
}
