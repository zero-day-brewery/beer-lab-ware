// @vitest-environment jsdom
// tests/unit/charts/time-series-chart.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TimeSeriesChart, type TimeSeriesChartProps } from '@/components/charts/time-series-chart'
import type { AxisConfig, SeriesConfig } from '@/lib/brewing/charts/types'
import { installResizeObserver } from '../../helpers/resize-observer'

const T0 = Date.parse('2026-07-04T00:00:00.000Z')
const DAY = 86_400_000
const gravity: SeriesConfig = {
  id: 'gravity',
  label: 'Gravity',
  axis: 'left',
  color: 'var(--wort, var(--malt))',
  area: true,
  format: (v) => v.toFixed(3),
  data: [
    { t: T0, v: 1.05 },
    { t: T0 + DAY, v: 1.03 },
    { t: T0 + 2 * DAY, v: 1.012 },
  ],
}
const left: AxisConfig = { label: 'Gravity', ticks: 5, format: (v) => v.toFixed(3) }

function props(overrides?: Partial<TimeSeriesChartProps>): TimeSeriesChartProps {
  return {
    series: [gravity],
    left,
    preferredId: 'gravity',
    testId: 'fermentation-chart',
    ...overrides,
  }
}

describe('TimeSeriesChart', () => {
  let restore: () => void
  afterEach(() => restore?.())

  it('renders the empty label when all series are empty', () => {
    restore = installResizeObserver(600)
    render(
      <TimeSeriesChart
        {...props({ series: [{ ...gravity, data: [] }], emptyLabel: 'Nothing yet' })}
      />,
    )
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="fermentation-chart"]')).toBeNull()
  })

  it('shows a skeleton until a width is measured', () => {
    restore = installResizeObserver(0) // never ready
    render(<TimeSeriesChart {...props()} />)
    expect(document.querySelector('[data-testid="chart-skeleton"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="fermentation-chart"]')).toBeNull()
  })

  it('renders an accessible SVG with series once measured', async () => {
    restore = installResizeObserver(600)
    render(<TimeSeriesChart {...props()} />)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="fermentation-chart"]')).not.toBeNull(),
    )
    const svg = document.querySelector('[data-testid="fermentation-chart"]') as SVGElement
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBeTruthy()
    expect(
      document
        .querySelector('[data-series-id="gravity"] path.chart-series-line')
        ?.getAttribute('d'),
    ).toBeTruthy()
    // Capture rect owns keyboard/pointer.
    const rect = document.querySelector('rect.chart-capture') as SVGElement
    expect(rect.getAttribute('tabindex')).toBe('0')
  })

  it('snaps the tooltip + live text to the reading under the pointer', async () => {
    restore = installResizeObserver(600)
    render(<TimeSeriesChart {...props()} />)
    await waitFor(() => expect(document.querySelector('rect.chart-capture')).not.toBeNull())
    const rect = document.querySelector('rect.chart-capture') as SVGElement
    // width 600 → inner.width 496, gravity points at cx [0,248,496]. jsdom's rect.left
    // is 0, so px = clientX. clientX 380 is nearest the LAST reading (gravity 1.012); a
    // stray `- inner.x` (px 328) would instead snap to the middle reading (1.030). This
    // asserts the VALUE, not merely that a tooltip node exists.
    fireEvent.pointerDown(rect, { clientX: 380, pointerId: 1 })
    fireEvent.pointerMove(rect, { clientX: 380, pointerId: 1 })
    await waitFor(() =>
      expect(document.querySelector('[data-testid="chart-tooltip"]')?.textContent).toContain(
        '1.012',
      ),
    )
    expect(document.querySelector('[data-testid="chart-live"]')?.textContent).toContain('1.012')
  })
})
