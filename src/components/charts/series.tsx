'use client'
import type { RenderSeries } from '@/lib/brewing/charts/types'

export function Series({ series }: { series: RenderSeries }) {
  return (
    <g className="chart-series" data-series-id={series.id} style={{ color: series.color }}>
      {series.areaPath && (
        <path className="chart-series-area" d={series.areaPath} fill="currentColor" stroke="none" />
      )}
      <path className="chart-series-line" d={series.linePath} fill="none" stroke="currentColor" />
      {series.points.map((pt) => (
        <circle
          key={`${pt.point.t}`}
          className="chart-point"
          cx={pt.cx}
          cy={pt.cy}
          r={2.5}
          fill="currentColor"
        />
      ))}
    </g>
  )
}
