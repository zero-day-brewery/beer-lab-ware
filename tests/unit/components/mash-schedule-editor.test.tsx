// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { MashScheduleEditor } from '@/components/recipe/mash-schedule-editor'
import type { Recipe } from '@/lib/brewing/types/recipe'

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({
    defaultValues: {
      mashSteps: [],
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
    } as unknown as Recipe,
  })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('MashScheduleEditor', () => {
  it('renders empty state with add button', () => {
    render(
      <Wrapper>
        <MashScheduleEditor />
      </Wrapper>,
    )
    expect(screen.getByText(/no mash steps/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add step/i })).toBeInTheDocument()
  })

  it('clicking add reveals a step row', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <MashScheduleEditor />
      </Wrapper>,
    )
    await user.click(screen.getByRole('button', { name: /add step/i }))
    expect(await screen.findByLabelText(/step name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/temperature/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/time/i)).toBeInTheDocument()
  })
})
