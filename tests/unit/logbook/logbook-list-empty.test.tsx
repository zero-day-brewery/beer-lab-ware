// tests/unit/logbook/logbook-list-empty.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({ isLoading: false, batches: [] }),
}))
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: { delete: vi.fn(), save: vi.fn(), get: vi.fn(), nextBatchNo: vi.fn() },
}))

import { LogbookList } from '@/components/logbook/logbook-list'

describe('LogbookList true-empty', () => {
  it('shows the empty-carboy scene with the No-batches copy', () => {
    const html = renderToStaticMarkup(<LogbookList />)
    expect(html).toContain('No batches yet.')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<svg')
  })
})
