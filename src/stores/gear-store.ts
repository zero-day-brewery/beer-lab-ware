'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { GearItem } from '@/lib/brewing/types/gear'
import { db } from '@/lib/db/schema'
import { reportDbError } from '@/lib/diagnostics/error-log'

interface GearState {
  items: GearItem[]
  isLoading: boolean
  setItems: (items: GearItem[]) => void
}

const useGearStoreInternal = create<GearState>((set) => ({
  items: [],
  isLoading: true,
  setItems: (items) => set({ items, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null

function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() => db.gearItems.orderBy('updatedAt').reverse().toArray()).subscribe({
    next: (items) => useGearStoreInternal.getState().setItems(items as GearItem[]),
    error: (e) => reportDbError('gear', e),
  })
}

export function useGearStore(): GearState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useGearStoreInternal()
}
