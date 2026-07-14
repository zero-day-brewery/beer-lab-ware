// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { HopsEditor } from '@/components/recipe/hops-editor'
import type { Recipe } from '@/lib/brewing/types/recipe'

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({
    defaultValues: {
      hops: [],
      fermentables: [],
      yeasts: [],
      miscs: [],
      mashSteps: [],
    } as unknown as Recipe,
  })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('HopsEditor', () => {
  it('renders empty state with add button', () => {
    render(
      <Wrapper>
        <HopsEditor />
      </Wrapper>,
    )
    expect(screen.getByText(/no hops/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add hop/i })).toBeInTheDocument()
  })

  it('clicking add reveals a new hop row', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <HopsEditor />
      </Wrapper>,
    )
    await user.click(screen.getByRole('button', { name: /add hop/i }))
    expect(await screen.findByLabelText(/hop name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/alpha/i)).toBeInTheDocument()
  })

  it('remove deletes the row', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <HopsEditor />
      </Wrapper>,
    )
    await user.click(screen.getByRole('button', { name: /add hop/i }))
    await user.click(screen.getByRole('button', { name: /remove hop/i }))
    expect(screen.queryByLabelText(/hop name/i)).not.toBeInTheDocument()
  })
})
