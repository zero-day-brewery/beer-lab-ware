// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipeEditView } from '@/components/recipe/recipe-edit-view'
import { db } from '@/lib/db/schema'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => ({ get: () => null }),
}))

describe('RecipeEditView (new mode)', () => {
  beforeEach(async () => {
    await db.recipes.clear()
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('renders header fields: name, type, batch size, boil time', async () => {
    render(<RecipeEditView mode="new" />)
    expect(await screen.findByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/batch size/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/boil time/i)).toBeInTheDocument()
  })

  it('renders a save button', async () => {
    render(<RecipeEditView mode="new" />)
    expect(await screen.findByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('shows validation error when name is empty on submit', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    await user.click(await screen.findByRole('button', { name: /save/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })
})
