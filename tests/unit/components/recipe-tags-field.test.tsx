// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipeEditView } from '@/components/recipe/recipe-edit-view'
import { db } from '@/lib/db/schema'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => ({ get: () => null }),
}))

describe('Recipe tag input', () => {
  beforeEach(async () => {
    await db.recipes.clear()
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('adds a chip on Enter', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    const input = await screen.findByLabelText(/add a tag/i)
    await user.type(input, 'ipa{Enter}')
    expect(screen.getByText('#ipa')).toBeInTheDocument()
    // Input clears after commit.
    expect(input).toHaveValue('')
  })

  it('adds a chip on comma', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    const input = await screen.findByLabelText(/add a tag/i)
    await user.type(input, 'stout,')
    expect(screen.getByText('#stout')).toBeInTheDocument()
  })

  it('trims whitespace and ignores blank input', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    const input = await screen.findByLabelText(/add a tag/i)
    await user.type(input, '   {Enter}') // blank → ignored
    await user.type(input, '  house  {Enter}') // trimmed
    expect(screen.getByText('#house')).toBeInTheDocument()
    expect(screen.queryByText('#')).not.toBeInTheDocument()
  })

  it('de-dupes an already-present tag', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    const input = await screen.findByLabelText(/add a tag/i)
    await user.type(input, 'ipa{Enter}')
    await user.type(input, 'ipa{Enter}')
    expect(screen.getAllByText('#ipa')).toHaveLength(1)
  })

  it('removes a chip via the ✕ button', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    const input = await screen.findByLabelText(/add a tag/i)
    await user.type(input, 'lager{Enter}')
    expect(screen.getByText('#lager')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /remove tag lager/i }))
    expect(screen.queryByText('#lager')).not.toBeInTheDocument()
  })

  it('serializes tags into the saved recipe', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    await user.clear(await screen.findByLabelText(/^name$/i))
    await user.type(screen.getByLabelText(/^name$/i), 'Tagged Ale')
    await user.type(screen.getByLabelText(/add a tag/i), 'house{Enter}')
    await user.type(screen.getByLabelText(/add a tag/i), 'ipa{Enter}')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(async () => {
      const all = await db.recipes.toArray()
      const saved = all.find((r) => r.name === 'Tagged Ale')
      expect(saved?.tags).toEqual(['house', 'ipa'])
    })
  })
})
