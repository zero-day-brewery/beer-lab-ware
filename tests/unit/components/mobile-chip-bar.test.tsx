// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { MobileChipBar } from '@/components/calc/mobile-chip-bar'
import type { Recipe } from '@/lib/brewing/types/recipe'

const sample: Partial<Recipe> = {
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
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({ defaultValues: sample as Recipe })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('MobileChipBar', () => {
  it('renders 5 chip labels (OG/FG/ABV/IBU/SRM)', () => {
    render(
      <Wrapper>
        <MobileChipBar />
      </Wrapper>,
    )
    for (const label of ['OG', 'FG', 'ABV', 'IBU', 'SRM']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
