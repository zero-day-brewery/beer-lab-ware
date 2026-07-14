/** One plotted sample: epoch-ms time + already-display-converted value. */
export interface SeriesPoint {
  t: number
  v: number
}

/** One line on the chart. `format` renders values for the tooltip/legend.
 *  There is exactly one curve (monotone) — `curve` is intentionally not an option. */
export interface SeriesConfig {
  id: string
  label: string
  data: SeriesPoint[]
  axis: 'left' | 'right'
  color: string
  area?: boolean
  format: (v: number) => string
}

/** Configuration for one y-axis. `nice` defaults to true; `pad` is a fraction. */
export interface AxisConfig {
  label: string
  domain?: [number, number]
  ticks?: number
  nice?: boolean
  pad?: number
  format: (v: number) => string
}

/** A rendered tick: its data value, pixel offset (inner-relative), and label. */
export interface Tick {
  value: number
  offset: number
  label: string
}

/** A rendered data mark (inner-relative pixel coords) + the source point. */
export interface PointMark {
  cx: number
  cy: number
  point: SeriesPoint
}

/** A series reduced to draw-ready SVG strings + marks. */
export interface RenderSeries {
  id: string
  color: string
  axis: 'left' | 'right'
  linePath: string
  areaPath?: string
  points: PointMark[]
}

/** The inner plotting rect (margins removed), in outer-SVG pixel coords. */
export interface ChartInner {
  x: number
  y: number
  width: number
  height: number
}

export interface ChartMargin {
  top: number
  right: number
  bottom: number
  left: number
}

/** Everything a renderer needs. `xToPx`/`pxToT` are pure closures for interactivity. */
export interface ChartModel {
  inner: ChartInner
  xTicks: Tick[]
  leftTicks: Tick[]
  rightTicks: Tick[]
  series: RenderSeries[]
  xToPx: (t: number) => number
  pxToT: (px: number) => number
}

export interface ChartModelInput {
  width: number
  height: number
  series: SeriesConfig[]
  left: AxisConfig
  right?: AxisConfig
  margin?: ChartMargin
}
