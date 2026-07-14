import { bisector } from 'd3-array'
import type { SeriesPoint } from './types'

const byTime = bisector<SeriesPoint, number>((d) => d.t).center

/** Index of the point nearest `t` (assumes ascending `t`). null when empty. */
export function nearestByTime(points: SeriesPoint[], t: number): number | null {
  if (points.length === 0) return null
  const i = byTime(points, t)
  return Math.max(0, Math.min(points.length - 1, i))
}

/** The point nearest `t`, or null when the series is empty. */
export function valueAtOrNearest(series: SeriesPoint[], t: number): SeriesPoint | null {
  const i = nearestByTime(series, t)
  return i === null ? null : series[i]
}
