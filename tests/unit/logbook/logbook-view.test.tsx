// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'

vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({
    isLoading: false,
    batches: [
      {
        id: 'a',
        batchNo: 1,
        name: 'IPA #1',
        status: 'complete',
        results: {},
        startedAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    ] as Batch[],
  }),
}))
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: { delete: vi.fn(), save: vi.fn(), get: vi.fn(), nextBatchNo: vi.fn() },
}))

import { LogbookView } from '@/components/logbook/logbook-view'

describe('LogbookView tab bar', () => {
  it('renders the List view by default', () => {
    render(<LogbookView />)
    // List view exposes per-row Re-brew actions; the Dashboard timeline heading is absent.
    expect(screen.getByText('Re-brew')).toBeInTheDocument()
    expect(screen.queryByText('Brew timeline')).not.toBeInTheDocument()
  })

  it('switches to the Dashboard view on click', async () => {
    const user = userEvent.setup()
    render(<LogbookView />)
    await user.click(screen.getByRole('button', { name: 'Dashboard' }))
    expect(screen.getByText('Brew timeline')).toBeInTheDocument()
    expect(screen.getByText('Total batches')).toBeInTheDocument()
    // List view is unmounted.
    expect(screen.queryByText('Re-brew')).not.toBeInTheDocument()
  })

  it('makes the previously-orphaned Trends view reachable', async () => {
    const user = userEvent.setup()
    render(<LogbookView />)
    await user.click(screen.getByRole('button', { name: 'Trends' }))
    expect(screen.getByText('Brewhouse efficiency')).toBeInTheDocument()
    expect(screen.getByText('Apparent attenuation')).toBeInTheDocument()
  })
})
