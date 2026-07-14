// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { StylePicker } from '@/components/recipe/style-picker'
import type { Recipe } from '@/lib/brewing/types/recipe'

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({ defaultValues: { styleId: '21A' } as unknown as Recipe })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('StylePicker', () => {
  it('renders a labeled select', () => {
    render(
      <Wrapper>
        <StylePicker />
      </Wrapper>,
    )
    expect(screen.getByLabelText(/style/i)).toBeInTheDocument()
  })

  it('includes American IPA (21A) as an option', () => {
    render(
      <Wrapper>
        <StylePicker />
      </Wrapper>,
    )
    expect(screen.getByRole('option', { name: /American IPA/i })).toBeInTheDocument()
  })
})
