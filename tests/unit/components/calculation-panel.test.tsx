// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { CalculationPanel } from '@/components/calc/calculation-panel'
import type { Recipe } from '@/lib/brewing/types/recipe'

const sampleRecipe: Partial<Recipe> = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440201',
      snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
      amount_g: 28,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440301',
      snapshot: { name: 'US-05', attenuation_min_pct: 75, attenuation_max_pct: 82, form: 'dry' },
      amount: 11.5,
    },
  ],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({ defaultValues: sampleRecipe as Recipe })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('CalculationPanel', () => {
  it('renders OG, FG, ABV, IBU, SRM labels', () => {
    render(
      <Wrapper>
        <CalculationPanel />
      </Wrapper>,
    )
    expect(screen.getByText(/^OG$/)).toBeInTheDocument()
    expect(screen.getByText(/^FG$/)).toBeInTheDocument()
    expect(screen.getByText(/^ABV$/)).toBeInTheDocument()
    expect(screen.getByText(/^IBU$/)).toBeInTheDocument()
    // SRM appears as both the gauge label and the beer-color swatch unit.
    expect(screen.getAllByText(/^SRM$/).length).toBeGreaterThan(0)
  })

  it('shows OG value approximately 1.05x for sample SMaSH recipe', () => {
    render(
      <Wrapper>
        <CalculationPanel />
      </Wrapper>,
    )
    expect(screen.getByText(/1\.05/)).toBeInTheDocument()
  })
})
