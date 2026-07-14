// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { db } from '@/lib/db/schema'

const ID = '550e8400-e29b-41d4-a716-446655440000'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`id=${ID}`),
}))
// Isolate the detail view from RecipeActions' router/toast deps.
vi.mock('@/components/recipe/recipe-actions', () => ({
  RecipeActions: () => null,
}))
vi.mock('@/stores/equipment-store', () => ({
  useEquipmentStore: () => ({ profiles: [B40PRO_PROFILE], isLoading: false }),
}))
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: () => ({ settings: { gravityUnit: 'sg' } }),
}))
vi.mock('@/stores/batches-store', () => ({
  useBatchesStore: () => ({ batches: [], isLoading: false, setBatches: () => {} }),
}))

const recipe: Recipe = {
  id: ID,
  name: 'Test IPA',
  type: 'all-grain',
  batchSize_L: 20,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: ID,
      snapshot: { name: 'Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: ID,
      snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' },
      amount_g: 30,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [
    {
      ingredientId: ID,
      snapshot: { name: 'US-05', attenuation_min_pct: 75, attenuation_max_pct: 80, form: 'dry' },
      amount: 1,
    },
  ],
  miscs: [],
  mashSteps: [
    { name: 'Sacch', type: 'infusion', temperature_C: 66, time_min: 60, waterAmount_L: 13 },
  ],
  notes_md: '',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  schemaVersion: 1,
}

describe('RecipeDetailView — brew history section', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipes.put(recipe)
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('still renders the existing brew-sheet sections', async () => {
    render(<RecipeDetailView />)
    expect(await screen.findByText('Fermentables')).toBeInTheDocument()
    expect(screen.getByText('Hops')).toBeInTheDocument()
    expect(screen.getByText('Mash')).toBeInTheDocument()
    expect(screen.getByText('Yeast')).toBeInTheDocument()
  })

  it('renders the Brew history section with the empty state when the recipe has no brews', async () => {
    render(<RecipeDetailView />)
    expect(await screen.findByText('Brew history')).toBeInTheDocument()
    expect(screen.getByText(/no brews yet/i)).toBeInTheDocument()
  })
})
