import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/brewing/batch/trends', () => ({
  efficiencyTrend: () => [
    { batchNo: 1, date: '2026-06-01', value: 72 },
    { batchNo: 2, date: '2026-06-10', value: 77 },
  ],
  attenuationTrend: () => [
    { batchNo: 1, date: '2026-06-01', value: 75 },
    { batchNo: 2, date: '2026-06-10', value: 78 },
  ],
  ogFgAccuracyTrend: () => [{ batchNo: 1, date: '2026-06-01', value: 0.5 }],
}))
vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({ isLoading: false, batches: [{ id: 'a' }, { id: 'b' }] }),
}))

import { sparklinePath, TrendsView } from '@/components/logbook/trends-view'

describe('sparklinePath', () => {
  it('maps N points to an SVG polyline path with N coordinate pairs', () => {
    const d = sparklinePath([72, 77, 74], 100, 20)
    expect(d.startsWith('M')).toBe(true)
    expect((d.match(/L|M/g) ?? []).length).toBe(3)
  })

  it('handles a single point without dividing by zero', () => {
    expect(() => sparklinePath([72], 100, 20)).not.toThrow()
  })
})

describe('TrendsView', () => {
  it('renders an svg sparkline per metric', () => {
    const html = renderToStaticMarkup(<TrendsView />)
    expect(html).toContain('trend-card')
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})
