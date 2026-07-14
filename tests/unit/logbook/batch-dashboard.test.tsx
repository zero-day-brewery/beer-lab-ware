import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'

// Mutable, hoisted store state so one file can cover populated + empty renders.
const state = vi.hoisted(() => ({ batches: [] as Batch[] }))

vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({ isLoading: false, batches: state.batches }),
}))

import { BatchDashboard } from '@/components/logbook/batch-dashboard'

const POPULATED: Batch[] = [
  {
    id: 'ipa',
    batchNo: 3,
    name: 'Zesty IPA',
    status: 'complete',
    brewedAt: '2026-07-10T00:00:00.000Z',
    startedAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    results: { measuredABV: 5 },
    tasting: { rating: 4 },
  },
  {
    id: 'amber',
    batchNo: 2,
    name: 'Mid Amber',
    status: 'complete',
    brewedAt: '2026-06-20T00:00:00.000Z',
    startedAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    results: { measuredABV: 7 },
    tasting: { rating: 4 },
  },
  {
    id: 'stout',
    batchNo: 1,
    name: 'Old Stout',
    status: 'archived',
    brewedAt: '2026-06-01T00:00:00.000Z',
    startedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    results: {},
  },
] as Batch[]

describe('BatchDashboard', () => {
  it('renders KPI tiles with computed values', () => {
    state.batches = POPULATED
    const html = renderToStaticMarkup(<BatchDashboard />)
    expect(html).toContain('Total batches')
    expect(html).toContain('Complete')
    expect(html).toContain('Brewed this month')
    expect(html).toContain('Avg ABV')
    expect(html).toContain('Avg rating')
    // avg measuredABV = (5 + 7) / 2 = 6.0%
    expect(html).toContain('6.0%')
    // avg rating = (4 + 4) / 2 = 4 → StarRatingDisplay(4)
    expect(html).toContain('4 of 5 stars')
  })

  it('lists the brew timeline newest-first with status chips and view links', () => {
    state.batches = POPULATED
    const html = renderToStaticMarkup(<BatchDashboard />)
    expect(html).toContain('Brew timeline')
    // Newest brewedAt first: IPA (Jul 10) → Amber (Jun 20) → Stout (Jun 1)
    expect(html.indexOf('Zesty IPA')).toBeLessThan(html.indexOf('Mid Amber'))
    expect(html.indexOf('Mid Amber')).toBeLessThan(html.indexOf('Old Stout'))
    expect(html).toContain('batchlist-chip--complete')
    expect(html).toContain('batchlist-chip--archived')
    // Same view route form as LogbookList (next/link normalizes the query route).
    expect(html).toContain('/logbook/view?id=ipa')
  })

  it('surfaces the most-brewed callout heading', () => {
    state.batches = POPULATED
    const html = renderToStaticMarkup(<BatchDashboard />)
    expect(html).toContain('Most brewed')
  })

  it('shows an empty state when there are no batches', () => {
    state.batches = []
    const html = renderToStaticMarkup(<BatchDashboard />)
    expect(html).toContain('No batches yet')
    expect(html).not.toContain('Brew timeline')
  })
})
