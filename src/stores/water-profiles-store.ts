'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Water } from '@/lib/brewing/types/ingredient'
import { db } from '@/lib/db/schema'
import { reportDbError } from '@/lib/diagnostics/error-log'

interface WaterProfilesState {
  profiles: Water[]
  isLoading: boolean
  setProfiles: (profiles: Water[]) => void
}

const useStore = create<WaterProfilesState>((set) => ({
  profiles: [],
  isLoading: true,
  setProfiles: (profiles) => set({ profiles, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null
function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() => db.waterProfiles.orderBy('name').toArray()).subscribe({
    next: (profiles) => useStore.getState().setProfiles(profiles as Water[]),
    error: (e) => reportDbError('waterProfiles', e),
  })
}

export function useWaterProfilesStore(): WaterProfilesState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useStore()
}
