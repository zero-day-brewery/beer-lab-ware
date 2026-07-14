// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { FermentablesEditor } from '@/components/recipe/fermentables-editor'
import type { Recipe } from '@/lib/brewing/types/recipe'

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({
    defaultValues: {
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
      mashSteps: [],
    } as unknown as Recipe,
  })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('FermentablesEditor', () => {
  it('renders empty state with add button', () => {
    render(
      <Wrapper>
        <FermentablesEditor />
      </Wrapper>,
    )
    expect(screen.getByText(/no fermentables/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add fermentable/i })).toBeInTheDocument()
  })

  it('clicking add reveals a new row', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <FermentablesEditor />
      </Wrapper>,
    )
    await user.click(screen.getByRole('button', { name: /add fermentable/i }))
    expect(await screen.findByLabelText(/fermentable name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
  })

  it('clicking remove deletes the row', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <FermentablesEditor />
      </Wrapper>,
    )
    await user.click(screen.getByRole('button', { name: /add fermentable/i }))
    await user.click(screen.getByRole('button', { name: /remove fermentable/i }))
    expect(screen.queryByLabelText(/fermentable name/i)).not.toBeInTheDocument()
  })
})
