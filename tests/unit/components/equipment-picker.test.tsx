// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { FormProvider, useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EquipmentPicker } from '@/components/recipe/equipment-picker'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { db } from '@/lib/db/schema'

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
  isDefault: true,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 1,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.2,
  evaporationRate_LperHr: 3,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.04,
  mashEfficiency_pct: 80,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1,
  calibrationNotes_md: '',
  schemaVersion: 1,
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<Recipe>({
    defaultValues: { equipmentProfileId: b40.id } as unknown as Recipe,
  })
  return <FormProvider {...form}>{children}</FormProvider>
}

describe('EquipmentPicker', () => {
  beforeEach(async () => {
    await db.equipmentProfiles.clear()
  })
  afterEach(async () => {
    await db.equipmentProfiles.clear()
  })

  it('renders a labeled select with available profiles', async () => {
    await db.equipmentProfiles.put(b40)
    render(
      <Wrapper>
        <EquipmentPicker />
      </Wrapper>,
    )
    expect(await screen.findByLabelText(/equipment/i)).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /b40 pro/i })).toBeInTheDocument()
  })
})
