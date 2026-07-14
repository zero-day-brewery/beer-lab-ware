// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { db } from '@/lib/db/schema'
import { useRecipesStore } from '@/stores/recipes-store'

const sampleRecipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'Test SMaSH',
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
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('useRecipesStore', () => {
  beforeEach(async () => {
    await db.recipes.clear()
  })
  afterEach(async () => {
    await db.recipes.clear()
  })

  it('starts with empty list (after subscription resolves)', async () => {
    const { result } = renderHook(() => useRecipesStore())
    await waitFor(() => expect(result.current.recipes).toEqual([]))
  })

  it('updates when a recipe is added', async () => {
    const { result } = renderHook(() => useRecipesStore())
    await act(async () => {
      await db.recipes.put(sampleRecipe)
    })
    await waitFor(() => {
      expect(result.current.recipes).toHaveLength(1)
      expect(result.current.recipes[0].name).toBe('Test SMaSH')
    })
  })
})
