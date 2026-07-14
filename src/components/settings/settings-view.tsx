'use client'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { DurabilitySection } from '@/components/durability/durability-section'
import { CompanionSection } from '@/components/settings/companion-section'
import { DataSection } from '@/components/settings/data-section'
import { useTheme } from '@/components/shell/theme-provider'
import type { GravityUnit, Settings, Theme, Units } from '@/lib/brewing/types/settings'
import { settingsRepo } from '@/lib/db/repos/settings'
import { newId } from '@/lib/utils/id'
import { useEquipmentStore } from '@/stores/equipment-store'
import { useSettingsStore } from '@/stores/settings-store'

function ensureSettings(): Promise<Settings> {
  return settingsRepo.get().then((s) => {
    if (s) return s
    const fresh: Settings = {
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: newId(),
      theme: 'metal-cyberpunk',
      schemaVersion: 1,
    }
    return settingsRepo.save(fresh)
  })
}

export function SettingsView() {
  const { settings } = useSettingsStore()
  const { profiles } = useEquipmentStore()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (settings === null) {
      ensureSettings().catch((e) => toast.error(`Settings init failed: ${(e as Error).message}`))
    }
  }, [settings])

  if (!settings) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  const update = async (patch: Partial<Settings>) => {
    try {
      const next: Settings = { ...settings, ...patch }
      await settingsRepo.save(next)
      if (patch.theme) setTheme(patch.theme)
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="border-b border-border/70 pb-6">
        <span className="eyebrow">⚙️ Setup</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Units</span>
        <select
          aria-label="Units"
          value={settings.units}
          onChange={(e) => update({ units: e.target.value as Units })}
          className="field"
        >
          <option value="metric">metric (L / kg / °C)</option>
          <option value="imperial">imperial (gal / lb / °F)</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Gravity readout</span>
        <select
          aria-label="Gravity readout"
          value={settings.gravityUnit ?? 'sg'}
          onChange={(e) => update({ gravityUnit: e.target.value as GravityUnit })}
          className="field"
        >
          <option value="sg">Specific gravity (1.048)</option>
          <option value="plato">Plato / Brix (11.9 °P)</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Theme</span>
        <select
          aria-label="Theme"
          value={theme}
          onChange={(e) => update({ theme: e.target.value as Theme })}
          className="field"
        >
          <option value="metal-cyberpunk">metal-cyberpunk</option>
          <option value="default">default</option>
          <option value="matrix">matrix</option>
          <option value="cyberpunk">cyberpunk</option>
          <option value="neon">neon</option>
          <option value="soundwave">soundwave</option>
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Default equipment</span>
        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No equipment profiles yet — add one at /equipment.
          </p>
        ) : (
          <select
            value={settings.defaultEquipmentProfileId}
            onChange={(e) => update({ defaultEquipmentProfileId: e.target.value })}
            className="field"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <CompanionSection />

      <DurabilitySection />

      <DataSection />
    </div>
  )
}
