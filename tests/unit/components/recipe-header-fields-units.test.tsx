// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, type UseFormReturn, useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecipeHeaderFields } from '@/components/recipe/recipe-header-fields'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Settings } from '@/lib/brewing/types/settings'
import { db } from '@/lib/db/schema'

const settingsRow = (units: Settings['units']): Settings => ({
  id: 'global',
  units,
  defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  theme: 'default',
  schemaVersion: 1,
})

let form: UseFormReturn<Recipe>

function Host() {
  form = useForm<Recipe>({
    defaultValues: {
      name: '',
      type: 'all-grain',
      batchSize_L: 19,
      boilTime_min: 60,
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
      mashSteps: [],
    } as unknown as Recipe,
  })
  return (
    <FormProvider {...form}>
      <RecipeHeaderFields form={form} />
    </FormProvider>
  )
}

describe('RecipeHeaderFields — display units', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })
  afterEach(async () => {
    await db.settings.clear()
  })

  it('metric (default): labels batch size in L and shows the canonical value', async () => {
    render(<Host />)
    expect(await screen.findByText('Batch size (L)')).toBeInTheDocument()
    expect(screen.getByLabelText(/batch size/i)).toHaveValue(19)
  })

  it('imperial: labels batch size in gal and seeds the converted value', async () => {
    await db.settings.put(settingsRow('imperial'))
    render(<Host />)
    expect(await screen.findByText('Batch size (gal)')).toBeInTheDocument()
    // 19 L = 5.019 gal at input precision.
    await waitFor(() => expect(screen.getByLabelText(/batch size/i)).toHaveValue(5.019))
  })

  it('imperial: typing gal parses back to canonical liters in the form state', async () => {
    await db.settings.put(settingsRow('imperial'))
    const user = userEvent.setup()
    render(<Host />)
    await screen.findByText('Batch size (gal)')

    const input = screen.getByLabelText(/batch size/i)
    await user.clear(input)
    await user.type(input, '5')

    // 5 gal = 18.927 L — the form (and therefore storage) stays metric.
    expect(form.getValues('batchSize_L')).toBeCloseTo(18.927, 2)
  })

  it('flipping settings to metric converts the visible value back to L', async () => {
    await db.settings.put(settingsRow('imperial'))
    render(<Host />)
    await screen.findByText('Batch size (gal)')

    await db.settings.put(settingsRow('metric'))
    expect(await screen.findByText('Batch size (L)')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(/batch size/i)).toHaveValue(19))
  })
})
