// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'

const h = vi.hoisted(() => ({
  del: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  nextBatchNo: vi.fn().mockResolvedValue(9),
}))

// A COMPLETED batch that kept its vessel (fermenterBoardId) and its spent-yeast
// marker — the realistic state you'd hit "Re-brew" from.
const completed = {
  id: 'a',
  batchNo: 2,
  name: 'IPA #2',
  status: 'complete',
  fermenterBoardId: 'f1',
  yeastDeducted: true,
  startedAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
} as unknown as Batch

vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({ isLoading: false, batches: [completed] }),
}))
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: {
    delete: (id: string) => h.del(id),
    save: (b: unknown) => h.save(b),
    nextBatchNo: () => h.nextBatchNo(),
    get: vi.fn(),
  },
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/components/brand/empty-scenes', () => ({ LogbookEmptyScene: () => null }))
vi.mock('@/components/ui/star-rating', () => ({ StarRatingDisplay: () => null }))

import { toast } from 'sonner'
import { LogbookList } from '@/components/logbook/logbook-list'

afterEach(() => vi.clearAllMocks())

describe('LogbookList — re-brew', () => {
  it('does NOT carry the fermenter vessel onto the clone (else it hijacks the board)', async () => {
    // With the atomic getOrCreateForBoard fix, an in-progress clone still bound
    // to f1 is exactly what the next guided session on f1 rehydrates — so a
    // re-brew must start unassigned to a vessel.
    render(<LogbookList />)
    await userEvent.click(screen.getByRole('button', { name: /re-brew/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())

    const clone = h.save.mock.calls[0][0] as Batch
    expect(clone.status).toBe('in-progress')
    expect(clone.fermenterBoardId).toBeUndefined()
  })

  it('resets yeastDeducted so the re-brew is a fresh pitch that deducts again', async () => {
    render(<LogbookList />)
    await userEvent.click(screen.getByRole('button', { name: /re-brew/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())

    const clone = h.save.mock.calls[0][0] as Batch
    expect(clone.yeastDeducted).toBeFalsy()
  })
})

describe('LogbookList — undo delete', () => {
  it('keeps the undo affordance and surfaces an error when restore fails', async () => {
    h.save.mockRejectedValueOnce(new Error('write failed'))
    render(<LogbookList />)

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    const undoBtn = await screen.findByRole('button', { name: /^undo$/i })
    await userEvent.click(undoBtn)

    // A failed restore must not silently consume the user's only recovery.
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeInTheDocument()
  })
})
