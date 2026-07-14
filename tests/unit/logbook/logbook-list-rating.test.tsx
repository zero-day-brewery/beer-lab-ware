import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'

vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({
    isLoading: false,
    batches: [
      {
        id: 'rated',
        batchNo: 3,
        name: 'Rated IPA',
        status: 'complete',
        tasting: { rating: 4, overall_md: 'Great.' },
        startedAt: '2026-06-20T00:00:00Z',
        updatedAt: '2026-06-20T00:00:00Z',
      },
      {
        id: 'unrated',
        batchNo: 2,
        name: 'Unrated Stout',
        status: 'complete',
        startedAt: '2026-06-10T00:00:00Z',
        updatedAt: '2026-06-10T00:00:00Z',
      },
      {
        id: 'zero',
        batchNo: 1,
        name: 'Zero Amber',
        status: 'complete',
        // rating: 0 is a real value (!= null) → still renders (0 filled stars).
        tasting: { rating: 0 },
        startedAt: '2026-06-05T00:00:00Z',
        updatedAt: '2026-06-05T00:00:00Z',
      },
    ] as Batch[],
  }),
}))
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: { delete: vi.fn(), save: vi.fn(), get: vi.fn(), nextBatchNo: vi.fn() },
}))

import { LogbookList } from '@/components/logbook/logbook-list'

describe('LogbookList — tasting rating stars', () => {
  it('shows read-only stars for a rated batch', () => {
    const html = renderToStaticMarkup(<LogbookList />)
    expect(html).toContain('4 of 5 stars')
    expect(html).toContain('star-rating-readonly')
  })

  it('renders stars for rating 0 (a real value) but none for an unrated batch', () => {
    const html = renderToStaticMarkup(<LogbookList />)
    // rated (4/5) + zero (0/5) render; the unrated batch (no tasting.rating) does not.
    const count = html.split('star-rating-readonly').length - 1
    expect(count).toBe(2)
    expect(html).toContain('0 of 5 stars')
  })
})
