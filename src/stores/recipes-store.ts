'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { db } from '@/lib/db/schema'
import { reportDbError } from '@/lib/diagnostics/error-log'

interface RecipesState {
  recipes: Recipe[]
  isLoading: boolean
  setRecipes: (recipes: Recipe[]) => void
}

const useRecipesStoreInternal = create<RecipesState>((set) => ({
  recipes: [],
  isLoading: true,
  setRecipes: (recipes) => set({ recipes, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null

function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() => db.recipes.orderBy('updatedAt').reverse().toArray()).subscribe({
    next: (recipes) => useRecipesStoreInternal.getState().setRecipes(recipes as Recipe[]),
    error: (e) => reportDbError('recipes', e),
  })
}

export function useRecipesStore(): RecipesState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useRecipesStoreInternal()
}
