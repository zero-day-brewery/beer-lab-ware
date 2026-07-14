// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EquipmentEditView } from '@/components/equipment/equipment-edit-view'
import { RecipeEditView } from '@/components/recipe/recipe-edit-view'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { equipmentRepo } from '@/lib/db/repos/equipment'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { db } from '@/lib/db/schema'

// Mutable route params / query so each test can target a specific id.
// RecipeEditView reads the id from ?id= (useSearchParams); EquipmentEditView
// still reads it from the [id] route segment (useParams).
const h = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  search: {} as Record<string, string | undefined>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => h.params,
  useSearchParams: () => ({ get: (k: string) => h.search[k] ?? null }),
}))

const seedRecipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Seeded IPA',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  notes_md: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  schemaVersion: 1,
  ...over,
})

const seedProfile = (over: Partial<EquipmentProfile> = {}): EquipmentProfile => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Seeded Rig',
  isDefault: false,
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
  ...over,
})

describe('RecipeEditView (edit mode)', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    h.params = {}
    h.search = {}
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('loads the existing recipe into the form (not a blank one)', async () => {
    await recipeRepo.save(seedRecipe())
    h.search = { id: '11111111-1111-4111-8111-111111111111' }
    render(<RecipeEditView mode="edit" />)
    expect(await screen.findByDisplayValue('Seeded IPA')).toBeInTheDocument()
  })

  it('updates in place on save — no duplicate record', async () => {
    await recipeRepo.save(seedRecipe())
    h.search = { id: '11111111-1111-4111-8111-111111111111' }
    const user = userEvent.setup()
    render(<RecipeEditView mode="edit" />)
    const name = await screen.findByDisplayValue('Seeded IPA')
    await user.clear(name)
    await user.type(name, 'Renamed IPA')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await new Promise((r) => setTimeout(r, 200))
    const all = await db.recipes.toArray()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('11111111-1111-4111-8111-111111111111')
    expect(all[0].name).toBe('Renamed IPA')
  })

  it('shows a not-found state for an unknown id', async () => {
    h.search = { id: 'does-not-exist' }
    render(<RecipeEditView mode="edit" />)
    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument()
  })
})

describe('EquipmentEditView (edit mode)', () => {
  beforeEach(async () => {
    await db.equipmentProfiles.clear()
    h.params = {}
    h.search = {}
  })
  afterEach(async () => {
    await db.equipmentProfiles.clear()
  })

  it('loads the existing profile into the form', async () => {
    await equipmentRepo.save(seedProfile())
    h.search = { id: '22222222-2222-4222-8222-222222222222' }
    render(<EquipmentEditView mode="edit" />)
    expect(await screen.findByDisplayValue('Seeded Rig')).toBeInTheDocument()
  })

  it('updates in place on save — no duplicate profile', async () => {
    await equipmentRepo.save(seedProfile())
    h.search = { id: '22222222-2222-4222-8222-222222222222' }
    const user = userEvent.setup()
    render(<EquipmentEditView mode="edit" />)
    const name = await screen.findByDisplayValue('Seeded Rig')
    await user.clear(name)
    await user.type(name, 'Renamed Rig')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await new Promise((r) => setTimeout(r, 200))
    const all = await db.equipmentProfiles.toArray()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('22222222-2222-4222-8222-222222222222')
    expect(all[0].name).toBe('Renamed Rig')
  })
})
