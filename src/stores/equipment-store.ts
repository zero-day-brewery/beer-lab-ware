'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import { db } from '@/lib/db/schema'
import { reportDbError } from '@/lib/diagnostics/error-log'

interface EquipmentState {
  profiles: EquipmentProfile[]
  isLoading: boolean
  setProfiles: (profiles: EquipmentProfile[]) => void
}

const useEquipmentStoreInternal = create<EquipmentState>((set) => ({
  profiles: [],
  isLoading: true,
  setProfiles: (profiles) => set({ profiles, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null

function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() => db.equipmentProfiles.orderBy('name').toArray()).subscribe({
    next: (profiles) =>
      useEquipmentStoreInternal.getState().setProfiles(profiles as EquipmentProfile[]),
    error: (e) => reportDbError('equipment', e),
  })
}

export function useEquipmentStore(): EquipmentState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useEquipmentStoreInternal()
}
