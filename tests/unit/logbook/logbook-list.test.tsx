import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'

vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({
    isLoading: false,
    batches: [
      {
        id: 'a',
        batchNo: 2,
        name: 'IPA #2',
        status: 'complete',
        startedAt: '2026-06-20T00:00:00Z',
        updatedAt: '2026-06-20T00:00:00Z',
      },
      {
        id: 'b',
        batchNo: 1,
        name: 'Stout #1',
        status: 'in-progress',
        startedAt: '2026-06-10T00:00:00Z',
        updatedAt: '2026-06-10T00:00:00Z',
      },
    ] as Batch[],
  }),
}))
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: { delete: vi.fn(), save: vi.fn(), get: vi.fn(), nextBatchNo: vi.fn() },
}))

import { LogbookList } from '@/components/logbook/logbook-list'

describe('LogbookList', () => {
  it('renders one row per batch with a view link to the query-param route', () => {
    const html = renderToStaticMarkup(<LogbookList />)
    expect(html).toContain('IPA #2')
    expect(html).toContain('Stout #1')
    expect(html).toContain('/logbook/view?id=a')
    expect(html).toContain('batchlist-row')
  })

  it('shows a status chip for each batch', () => {
    const html = renderToStaticMarkup(<LogbookList />)
    expect(html).toContain('in-progress')
    expect(html).toContain('complete')
  })
})
