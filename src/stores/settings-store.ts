'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import { type Settings, SettingsSchema } from '@/lib/brewing/types/settings'
import { db } from '@/lib/db/schema'
import { recordError, reportDbError } from '@/lib/diagnostics/error-log'

interface SettingsState {
  settings: Settings | null
  isLoading: boolean
  setSettings: (settings: Settings | null) => void
}

const useSettingsStoreInternal = create<SettingsState>((set) => ({
  settings: null,
  isLoading: true,
  setSettings: (settings) => set({ settings, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null

function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() => db.settings.get('global')).subscribe({
    next: (s) => {
      // Validate on read so a corrupt row degrades to defaults instead of
      // silently poisoning every consumer with an unchecked `as Settings` cast.
      const parsed = s ? SettingsSchema.safeParse(s) : null
      if (s && parsed && !parsed.success) {
        recordError('settings-row', parsed.error)
      }
      useSettingsStoreInternal.getState().setSettings(parsed && parsed.success ? parsed.data : null)
    },
    error: (e) => reportDbError('settings', e),
  })
}

export function useSettingsStore(): SettingsState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useSettingsStoreInternal()
}
