'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  type CompanionSettings,
  CompanionSettingsSchema,
  DEFAULT_COMPANION_SETTINGS,
} from '@/lib/ai/settings'

/**
 * Companion (AI) settings store — bring-your-own-key, LOCAL only.
 *
 * Mirrors the app's other zustand-persist store (`session-store`, key `brew-session`):
 * state is persisted to localStorage under `brew-companion`. Storing it here rather
 * than in a Dexie table is deliberate — it keeps the API key OUT of the JSON data
 * backup/export dump (which reads Dexie tables only), so exporting your brewing data
 * never carries your secret. The key is never sent anywhere but the chosen provider's
 * own request (see `makeProvider`) and is never logged.
 *
 * The persisted blob is Zod-validated on rehydrate (via `merge`) — a corrupt row
 * degrades to defaults instead of poisoning consumers, matching the settings-store
 * "validate on read" discipline.
 */
interface CompanionSettingsState {
  settings: CompanionSettings
  /** Shallow-merge a patch (individual field edits from the panel). */
  update: (patch: Partial<CompanionSettings>) => void
  /** Restore the out-of-the-box defaults (clears the key). */
  reset: () => void
}

export const useCompanionSettingsStore = create<CompanionSettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_COMPANION_SETTINGS,
      update: (patch) => set({ settings: { ...get().settings, ...patch } }),
      reset: () => set({ settings: DEFAULT_COMPANION_SETTINGS }),
    }),
    {
      name: 'brew-companion',
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const raw = (persisted as { settings?: unknown } | undefined)?.settings
        const parsed = CompanionSettingsSchema.safeParse(raw)
        return { ...current, settings: parsed.success ? parsed.data : current.settings }
      },
    },
  ),
)
