// @vitest-environment jsdom
// tests/unit/charts/primitives.test.tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Axis } from '@/components/charts/axis'
import { Crosshair } from '@/components/charts/crosshair'
import { Gridlines } from '@/components/charts/gridlines'
import { Legend } from '@/components/charts/legend'
import { Series } from '@/components/charts/series'
import { Tooltip } from '@/components/charts/tooltip'
import type { RenderSeries, Tick } from '@/lib/brewing/charts/types'

const ticks: Tick[] = [
  { value: 1.01, offset: 10, label: '1.010' },
  { value: 1.05, offset: 150, label: '1.050' },
]

function svg(node: React.ReactNode) {
  return render(
    <svg>
      <title>test</title>
      {node}
    </svg>,
  )
}

describe('chart primitives', () => {
  it('Axis renders one text per tick plus its axis label', () => {
    svg(<Axis orientation="left" ticks={ticks} length={160} label="Gravity" />)
    expect(document.querySelectorAll('.chart-axis-text')).toHaveLength(2)
    expect(document.querySelector('[data-testid="axis-label-left"]')?.textContent).toBe('Gravity')
  })

  it('Gridlines draws one horizontal line per tick spanning the width', () => {
    svg(<Gridlines ticks={ticks} width={296} />)
    const lines = document.querySelectorAll('line.chart-gridline')
    expect(lines).toHaveLength(2)
    expect(lines[0].getAttribute('x2')).toBe('296')
  })

  it('Series renders the line, area, points and a stable data-series-id', () => {
    const rs: RenderSeries = {
      id: 'gravity',
      color: 'var(--wort, var(--malt))',
      axis: 'left',
      linePath: 'M0,10C1,1 2,2 3,3',
      areaPath: 'M0,160L0,10',
      points: [
        { cx: 0, cy: 10, point: { t: 0, v: 1.05 } },
        { cx: 148, cy: 80, point: { t: 1, v: 1.03 } },
      ],
    }
    svg(<Series series={rs} />)
    const g = document.querySelector('[data-series-id="gravity"]')
    expect(g).not.toBeNull()
    expect(g?.querySelector('path.chart-series-line')?.getAttribute('d')).toBe('M0,10C1,1 2,2 3,3')
    expect(g?.querySelector('path.chart-series-area')).not.toBeNull()
    expect(g?.querySelectorAll('circle.chart-point')).toHaveLength(2)
  })

  it('Crosshair draws a vertical line and one dot per mark', () => {
    svg(
      <Crosshair x={100} height={160} marks={[{ id: 'gravity', cx: 100, cy: 40, color: 'red' }]} />,
    )
    expect(document.querySelector('line.chart-crosshair-line')?.getAttribute('x1')).toBe('100')
    expect(document.querySelectorAll('circle.chart-crosshair-dot')).toHaveLength(1)
  })

  it('Tooltip renders a title + one row per series and edge-flips near the right', () => {
    const { rerender } = render(
      <Tooltip
        x={10}
        y={20}
        width={400}
        title="07-04 12:00"
        rows={[{ id: 'gravity', label: 'Gravity', value: '1.030', color: 'red' }]}
      />,
    )
    expect(document.querySelector('.chart-tooltip-title')?.textContent).toBe('07-04 12:00')
    expect(document.querySelectorAll('.chart-tooltip-row')).toHaveLength(1)
    // Near the right edge → flips (transform includes -100%).
    rerender(<Tooltip x={360} y={20} width={400} title="t" rows={[]} />)
    const el = document.querySelector('.chart-tooltip') as HTMLElement
    expect(el.style.transform).toContain('-100%')
  })

  it('Legend renders one item per series', () => {
    render(
      <Legend
        items={[
          { id: 'gravity', label: 'Gravity', color: 'red' },
          { id: 'temp', label: 'Temp °C', color: 'blue' },
        ]}
      />,
    )
    expect(document.querySelectorAll('.chart-legend-item')).toHaveLength(2)
  })
})
