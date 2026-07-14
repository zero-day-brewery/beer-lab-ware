// @vitest-environment jsdom
// tests/unit/charts/fermentation-chart.test.tsx
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FermentationChart } from '@/components/charts/fermentation-chart'
import type { Reading } from '@/lib/brewing/types/reading'
import { installResizeObserver } from '../../helpers/resize-observer'

const readings: Reading[] = [
  {
    id: '1',
    batchId: 'b',
    at: '2026-07-04T00:00:00.000Z',
    gravity: 1.05,
    tempC: 20,
    schemaVersion: 1,
  },
  {
    id: '2',
    batchId: 'b',
    at: '2026-07-05T00:00:00.000Z',
    gravity: 1.03,
    tempC: 21,
    schemaVersion: 1,
  },
  {
    id: '3',
    batchId: 'b',
    at: '2026-07-06T00:00:00.000Z',
    gravity: 1.012,
    tempC: 19,
    schemaVersion: 1,
  },
]

describe('FermentationChart', () => {
  let restore: () => void
  afterEach(() => restore?.())

  it('renders the fermentation-chart testid with gravity + temp series', async () => {
    restore = installResizeObserver(600)
    render(<FermentationChart readings={readings} units="metric" />)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="fermentation-chart"]')).not.toBeNull(),
    )
    expect(
      document
        .querySelector('[data-series-id="gravity"] path.chart-series-line')
        ?.getAttribute('d'),
    ).toBeTruthy()
    expect(
      document.querySelector('[data-series-id="temp"] path.chart-series-line')?.getAttribute('d'),
    ).toBeTruthy()
  })

  it('converts °C→°F in the caller when units are imperial', async () => {
    restore = installResizeObserver(600)
    const { container } = render(<FermentationChart readings={readings} units="imperial" />)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="fermentation-chart"]')).not.toBeNull(),
    )
    // Right axis label + legend carry the °F unit.
    expect(container.textContent).toContain('°F')
  })

  it('shows the empty label when there are no readings', () => {
    restore = installResizeObserver(600)
    const { getByText } = render(<FermentationChart readings={[]} units="metric" />)
    expect(getByText(/Log a reading to start the fermentation curve/i)).toBeInTheDocument()
  })
})
