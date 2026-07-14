// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionCard } from '@/components/ai/action-card'
import type { ApplyResult } from '@/lib/ai/actions/apply'
import type {
  AdjustInventoryAction,
  LogReadingAction,
  ScaleRecipeAction,
} from '@/lib/ai/actions/types'

const scaleAction: ScaleRecipeAction = {
  type: 'scale_recipe',
  title: 'Scale "West Coast IPA" → 40 L',
  preview: {
    recipeName: 'West Coast IPA',
    before: { batchSize_L: 20, OG: 1.062 },
    after: { batchSize_L: 40, OG: 1.061 },
  },
  payload: { name: 'West Coast IPA (scaled)' } as ScaleRecipeAction['payload'],
}

const readingAction: LogReadingAction = {
  type: 'log_reading',
  title: 'Log reading for "SMaSH #1"',
  preview: 'Add SG 1.03 @ 19°C to "SMaSH #1"',
  payload: {} as LogReadingAction['payload'],
}

const invAction: AdjustInventoryAction = {
  type: 'adjust_inventory',
  title: 'Adjust "Cascade" stock',
  preview: 'Cascade: 50 → 30 g',
  payload: {} as AdjustInventoryAction['payload'],
}

const okRecipe: ApplyResult = {
  ok: true,
  result: { kind: 'recipe', recipe: { name: 'West Coast IPA (scaled)' } as never },
}
const okInventory: ApplyResult = {
  ok: true,
  result: { kind: 'inventory', inventoryItemId: 'x', newAmount: 30 },
}

describe('ActionCard — truthful preview', () => {
  it('renders a scale before→after preview (batch size + OG), not a made-up number', () => {
    render(<ActionCard action={scaleAction} apply={vi.fn()} />)
    expect(screen.getByText('Scale "West Coast IPA" → 40 L')).toBeInTheDocument()
    expect(screen.getByText('West Coast IPA')).toBeInTheDocument()
    // before + after batch size, straight from the proposal
    expect(screen.getByText('20 L')).toBeInTheDocument()
    expect(screen.getByText('40 L')).toBeInTheDocument()
    // OG rendered to 3dp
    expect(screen.getByText('1.062')).toBeInTheDocument()
    expect(screen.getByText('1.061')).toBeInTheDocument()
  })

  it('renders a string preview verbatim for log_reading', () => {
    render(<ActionCard action={readingAction} apply={vi.fn()} />)
    expect(screen.getByText('Add SG 1.03 @ 19°C to "SMaSH #1"')).toBeInTheDocument()
  })
})

describe('ActionCard — Approve is the ONLY write trigger', () => {
  it('does NOT call apply on render/mount', () => {
    const apply = vi.fn<() => Promise<ApplyResult>>()
    render(<ActionCard action={scaleAction} apply={apply} />)
    expect(apply).not.toHaveBeenCalled()
  })

  it('Approve → calls apply ONCE and moves to applied (showing the result)', async () => {
    const apply = vi.fn(async () => okRecipe)
    render(<ActionCard action={scaleAction} apply={apply} />)

    await userEvent.click(screen.getByRole('button', { name: /^Approve:/ }))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(scaleAction)
    expect(await screen.findByText('✓ Saved "West Coast IPA (scaled)"')).toBeInTheDocument()
    // Buttons are gone once committed.
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Discard/ })).toBeNull()
  })

  it('shows the inventory write result ("Stock now n")', async () => {
    const apply = vi.fn(async () => okInventory)
    render(<ActionCard action={invAction} apply={apply} />)
    await userEvent.click(screen.getByRole('button', { name: /^Approve:/ }))
    expect(await screen.findByText('✓ Stock now 30')).toBeInTheDocument()
  })
})

describe('ActionCard — Discard writes nothing', () => {
  it('Discard dismisses the card WITHOUT calling apply', async () => {
    const apply = vi.fn<() => Promise<ApplyResult>>()
    render(<ActionCard action={scaleAction} apply={apply} />)

    await userEvent.click(screen.getByRole('button', { name: /^Discard:/ }))

    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByText(/Discarded/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
  })
})

describe('ActionCard — double-apply guard', () => {
  it('a second Approve while in-flight is a no-op (commits at most once)', async () => {
    // apply never resolves → the card stays "applying" so we can click again.
    let resolve!: (r: ApplyResult) => void
    const pending = new Promise<ApplyResult>((r) => {
      resolve = r
    })
    const apply = vi.fn(() => pending)
    render(<ActionCard action={scaleAction} apply={apply} />)

    const approve = screen.getByRole('button', { name: /^Approve:/ })
    await userEvent.click(approve)
    // Now disabled + relabelled; force a second click through the disabled guard.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Saving/ })).toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /^Saving/ }))

    expect(apply).toHaveBeenCalledTimes(1)

    resolve(okRecipe)
    expect(await screen.findByText(/✓ Saved/)).toBeInTheDocument()
    // Still exactly one write.
    expect(apply).toHaveBeenCalledTimes(1)
  })
})

describe('ActionCard — error + retry', () => {
  it('apply {ok:false} → error state, then Retry re-applies and succeeds', async () => {
    const apply = vi
      .fn<(a: unknown) => Promise<ApplyResult>>()
      .mockResolvedValueOnce({ ok: false, error: 'stock ledger locked' })
      .mockResolvedValueOnce(okRecipe)
    render(<ActionCard action={scaleAction} apply={apply} />)

    await userEvent.click(screen.getByRole('button', { name: /^Approve:/ }))

    const err = await screen.findByRole('alert')
    expect(err).toHaveTextContent(/stock ledger locked/)
    // Retry is offered.
    const retry = screen.getByRole('button', { name: /^Retry:/ })
    await userEvent.click(retry)

    expect(apply).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/✓ Saved/)).toBeInTheDocument()
  })
})
