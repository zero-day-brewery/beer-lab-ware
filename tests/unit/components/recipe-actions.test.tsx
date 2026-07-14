// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipeActions } from '@/components/recipe/recipe-actions'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { db } from '@/lib/db/schema'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/stores/equipment-store', () => ({
  useEquipmentStore: () => ({ profiles: [B40PRO_PROFILE], isLoading: false }),
}))

const ID = '550e8400-e29b-41d4-a716-446655440000'
const base: Recipe = {
  id: ID,
  name: 'Test IPA',
  type: 'all-grain',
  batchSize_L: 20,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: ID,
      snapshot: { name: 'Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  targets: { OG: 1.05 },
  notes_md: '',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  schemaVersion: 1,
}

describe('RecipeActions — Duplicate', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    push.mockClear()
  })
  afterEach(async () => {
    await db.recipes.clear()
    vi.restoreAllMocks()
  })

  it('renders the per-recipe actions incl. Duplicate (no regression)', () => {
    render(<RecipeActions recipe={base} />)
    expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /scale/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('calls recipeRepo.save with an independent clone and opens it', async () => {
    const saveSpy = vi.spyOn(recipeRepo, 'save')
    const user = userEvent.setup()
    render(<RecipeActions recipe={base} />)

    await user.click(screen.getByRole('button', { name: /duplicate/i }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
    const arg = saveSpy.mock.calls[0][0]
    expect(arg.id).not.toBe(base.id)
    expect(arg.name).toBe('Test IPA (copy)')
    expect(arg).not.toBe(base)
    expect(arg.fermentables).not.toBe(base.fermentables)

    // Persisted to the DB and navigation opens the new copy's view.
    const saved = await db.recipes.get(arg.id)
    expect(saved?.name).toBe('Test IPA (copy)')
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/recipes/view/?id=${arg.id}`))

    // Original row is untouched.
    expect(await db.recipes.get(base.id)).toBeUndefined()
  })
})

describe('RecipeActions — Scale modal', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    push.mockClear()
  })
  afterEach(async () => {
    await db.recipes.clear()
    vi.restoreAllMocks()
  })

  async function openScale(user: ReturnType<typeof userEvent.setup>) {
    render(<RecipeActions recipe={base} />)
    await user.click(screen.getByRole('button', { name: /^scale$/i }))
  }

  it('toggles between the batch-size and target-OG inputs', async () => {
    const user = userEvent.setup()
    await openScale(user)

    // Opens on batch-size mode.
    expect(screen.getByRole('spinbutton', { name: /new batch size/i })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /target og/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /by target og/i }))
    expect(screen.getByRole('spinbutton', { name: /target og/i })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /new batch size/i })).not.toBeInTheDocument()
  })

  it('shows a live before → after preview in batch-size mode', async () => {
    const user = userEvent.setup()
    await openScale(user)

    const sizeInput = screen.getByRole('spinbutton', { name: /new batch size/i })
    await user.clear(sizeInput)
    await user.type(sizeInput, '40')

    // Total grain doubles (4 kg → 8 kg) at 2× the batch size.
    expect(screen.getByText('4.000')).toBeInTheDocument()
    expect(screen.getByText('8.000')).toBeInTheDocument()
    // Header columns exist.
    expect(screen.getByRole('columnheader', { name: /before/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /after/i })).toBeInTheDocument()
  })

  it('shows a live before → after preview in target-OG mode', async () => {
    const user = userEvent.setup()
    await openScale(user)
    await user.click(screen.getByRole('button', { name: /by target og/i }))

    // Default target is the recipe's stored target OG (1.050); the after-OG
    // column lands on exactly that (grain-only scale, calcOG is linear).
    expect(screen.getByRole('spinbutton', { name: /target og/i })).toHaveValue(1.05)
    expect(screen.getByText('1.050')).toBeInTheDocument()
  })

  it('Apply saves the scaled recipe with fresh targets and navigates', async () => {
    const saveSpy = vi.spyOn(recipeRepo, 'save')
    const user = userEvent.setup()
    await openScale(user)

    const sizeInput = screen.getByRole('spinbutton', { name: /new batch size/i })
    await user.clear(sizeInput)
    await user.type(sizeInput, '40')
    await user.click(screen.getByRole('button', { name: /apply/i }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
    const arg = saveSpy.mock.calls[0][0]
    expect(arg.id).not.toBe(base.id)
    expect(arg.batchSize_L).toBe(40)
    // Fresh (non-stale) targets were written from the calc pipeline.
    expect(typeof arg.targets?.OG).toBe('number')
    expect(typeof arg.targets?.IBU).toBe('number')

    const saved = await db.recipes.get(arg.id)
    expect(saved?.batchSize_L).toBe(40)
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/recipes/view/?id=${arg.id}`))

    // Original prop object is never mutated.
    expect(base.batchSize_L).toBe(20)
    expect(base.fermentables[0].amount_kg).toBe(4)
  })

  it('disables Apply when the input is invalid', async () => {
    const user = userEvent.setup()
    await openScale(user)
    await user.click(screen.getByRole('button', { name: /by target og/i }))

    const ogInput = screen.getByRole('spinbutton', { name: /target og/i })
    await user.clear(ogInput)

    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
  })
})
