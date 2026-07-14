// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { YeastsEditor } from '@/components/recipe/yeasts-editor'
import type { Recipe } from '@/lib/brewing/types/recipe'

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({
    defaultValues: {
      yeasts: [],
      hops: [],
      fermentables: [],
      miscs: [],
      mashSteps: [],
    } as unknown as Recipe,
  })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('YeastsEditor', () => {
  it('renders empty state with add button', () => {
    render(
      <Wrapper>
        <YeastsEditor />
      </Wrapper>,
    )
    expect(screen.getByText(/no yeasts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add yeast/i })).toBeInTheDocument()
  })

  it('clicking add reveals yeast name input', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <YeastsEditor />
      </Wrapper>,
    )
    await user.click(screen.getByRole('button', { name: /add yeast/i }))
    expect(await screen.findByLabelText(/yeast name/i)).toBeInTheDocument()
  })
})
