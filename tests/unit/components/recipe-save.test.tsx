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

describe('Recipe save', () => {
  beforeEach(async () => {
    await db.recipes.clear()
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('saves a valid recipe to the database', async () => {
    const user = userEvent.setup()
    render(<RecipeEditView mode="new" />)
    await user.clear(screen.getByLabelText(/name/i))
    await user.type(screen.getByLabelText(/name/i), 'Save Test')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await new Promise((r) => setTimeout(r, 150))
    const all = await db.recipes.toArray()
    expect(all.find((r) => r.name === 'Save Test')).toBeDefined()
  })
})
