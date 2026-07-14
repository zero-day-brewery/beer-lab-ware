// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=b1'),
}))
const saveMock = vi.fn()
vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: { save: (...a: unknown[]) => saveMock(...a), get: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

import { TastingEditor } from '@/components/logbook/batch-sheet-view'

const baseBatch = {
  id: 'b1',
  batchNo: 1,
  name: 'SMaSH #1',
  status: 'complete',
  process: [],
  logs: [],
  timers: [],
  results: {},
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
} as unknown as Batch

function withTasting(tasting: Batch['tasting']): Batch {
  return { ...baseBatch, tasting }
}

describe('TastingEditor', () => {
  beforeEach(() => {
    saveMock.mockReset()
    saveMock.mockImplementation(async (b: Batch) => b)
  })

  it('seeds fields from batch.tasting and disables Save while unchanged', () => {
    render(
      <TastingEditor batch={withTasting({ rating: 3, overall_md: 'Nice.' })} onSaved={() => {}} />,
    )

    expect(screen.getByLabelText('Overall notes')).toHaveValue('Nice.')
    // 3 filled stars seeded from the rating.
    expect(document.querySelectorAll('.star-rating-star.is-filled')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /save tasting/i })).toBeDisabled()
  })

  it('editing a note + setting a rating enables Save and writes the merged tasting', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<TastingEditor batch={baseBatch} onSaved={onSaved} />)

    const save = screen.getByRole('button', { name: /save tasting/i })
    expect(save).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.type(screen.getByLabelText('Aroma notes'), 'Bright citrus')

    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    const arg = saveMock.mock.calls[0][0] as Batch
    expect(arg.id).toBe('b1')
    expect(arg.tasting).toEqual({
      rating: 4,
      aroma_md: 'Bright citrus',
      // blank fields serialize to undefined, not ''
      appearance_md: undefined,
      flavor_md: undefined,
      mouthfeel_md: undefined,
      overall_md: undefined,
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('preserves other batch fields (full-object save) and existing bjcp on the tasting', async () => {
    const user = userEvent.setup()
    render(
      <TastingEditor
        batch={withTasting({
          bjcp: { aroma: 8, appearance: 3, flavor: 15, mouthfeel: 4, overall: 8, total: 38 },
        })}
        onSaved={() => {}}
      />,
    )

    await user.click(screen.getByRole('radio', { name: '5 stars' }))
    await user.click(screen.getByRole('button', { name: /save tasting/i }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    const arg = saveMock.mock.calls[0][0] as Batch
    // Non-tasting batch fields survive the save.
    expect(arg.batchNo).toBe(1)
    expect(arg.status).toBe('complete')
    // Existing bjcp block is merged through, not dropped.
    expect(arg.tasting?.bjcp?.total).toBe(38)
    expect(arg.tasting?.rating).toBe(5)
  })

  it('clearing an existing rating to 0 drops it (undefined) on save', async () => {
    const user = userEvent.setup()
    render(<TastingEditor batch={withTasting({ rating: 4 })} onSaved={() => {}} />)

    await user.click(screen.getByRole('button', { name: /clear rating/i }))
    await user.click(screen.getByRole('button', { name: /save tasting/i }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    const arg = saveMock.mock.calls[0][0] as Batch
    expect(arg.tasting?.rating).toBeUndefined()
  })
})
