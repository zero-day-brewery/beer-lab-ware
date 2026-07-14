// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecipeListView } from '@/components/recipe/recipe-list-view'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { db } from '@/lib/db/schema'

const recipeA: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'IPA #1',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

const ipa: Recipe = { ...recipeA, tags: ['ipa', 'house'] }
const stout: Recipe = {
  ...recipeA,
  id: '550e8400-e29b-41d4-a716-446655440002',
  name: 'Dry Stout',
  tags: ['stout', 'dark'],
  updatedAt: '2026-05-13T00:00:00.000Z',
}

describe('RecipeListView', () => {
  beforeEach(async () => {
    await db.recipes.clear()
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('shows empty state when no recipes', async () => {
    render(<RecipeListView />)
    expect(await screen.findByText(/brew your first beer/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /new recipe/i })).toBeInTheDocument()
  })

  it('renders a card per recipe', async () => {
    await db.recipes.put(recipeA)
    render(<RecipeListView />)
    expect(await screen.findByText('IPA #1')).toBeInTheDocument()
  })

  it('filters the grid as you type in the search box', async () => {
    const user = userEvent.setup()
    await db.recipes.bulkPut([ipa, stout])
    render(<RecipeListView />)
    expect(await screen.findByText('IPA #1')).toBeInTheDocument()
    expect(screen.getByText('Dry Stout')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'stout')

    await waitFor(() => expect(screen.queryByText('IPA #1')).not.toBeInTheDocument())
    expect(screen.getByText('Dry Stout')).toBeInTheDocument()
  })

  it('filters by toggling a tag chip (AND semantics)', async () => {
    const user = userEvent.setup()
    await db.recipes.bulkPut([ipa, stout])
    render(<RecipeListView />)
    expect(await screen.findByText('IPA #1')).toBeInTheDocument()

    // The filter chips are buttons; the card chips are plain spans.
    await user.click(screen.getByRole('button', { name: '#ipa' }))

    await waitFor(() => expect(screen.queryByText('Dry Stout')).not.toBeInTheDocument())
    expect(screen.getByText('IPA #1')).toBeInTheDocument()

    // Header reflects the filtered count.
    expect(screen.getByText(/1 of 2 recipes/i)).toBeInTheDocument()
  })

  it('shows a filtered-empty message when nothing matches', async () => {
    const user = userEvent.setup()
    await db.recipes.bulkPut([ipa, stout])
    render(<RecipeListView />)
    expect(await screen.findByText('IPA #1')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: /search recipes/i }), 'zzznope')

    expect(await screen.findByText(/no recipes match/i)).toBeInTheDocument()
    expect(screen.queryByText('IPA #1')).not.toBeInTheDocument()
    expect(screen.queryByText('Dry Stout')).not.toBeInTheDocument()
  })

  it('keeps the EmptyState (not the filtered-empty message) at zero recipes', async () => {
    render(<RecipeListView />)
    expect(await screen.findByText(/brew your first beer/i)).toBeInTheDocument()
    expect(screen.queryByText(/no recipes match/i)).not.toBeInTheDocument()
    // No search box renders in the empty state.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('true-empty state shows the brand scene and no private-brand strings', async () => {
    render(<RecipeListView />)
    expect(await screen.findByText(/brew your first beer/i)).toBeInTheDocument()
    expect(document.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByText(/track ingredients/i)).toBeInTheDocument()
    expect(screen.queryByText('🍺')).not.toBeInTheDocument()
  })

  it('list header eyebrow is scrubbed of the private brand', async () => {
    await db.recipes.put(recipeA)
    render(<RecipeListView />)
    expect(await screen.findByText('IPA #1')).toBeInTheDocument()
    expect(screen.getByText(/on tap/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /recipes/i, level: 1 })).toBeInTheDocument()
  })
})
