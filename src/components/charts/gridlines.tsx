'use client'
import type { Tick } from '@/lib/brewing/charts/types'

/** Horizontal gridlines from the LEFT axis ticks only. The right axis draws its
 *  own ticks/labels but no full gridlines (two independent y-scales, by design). */
export function Gridlines({ ticks, width }: { ticks: Tick[]; width: number }) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative gridline group, not focusable
    <g className="chart-grid" data-testid="chart-grid" aria-hidden="true">
      {ticks.map((t) => (
        <line
          key={`${t.value}`}
          className="chart-gridline"
          x1={0}
          x2={width}
          y1={t.offset}
          y2={t.offset}
        />
      ))}
    </g>
  )
}
