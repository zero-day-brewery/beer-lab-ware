'use client'
import { BackupSettingsCard } from '@/components/durability/backup-settings-card'
import { DurabilityBadge } from '@/components/durability/durability-badge'
import { EvictionWarning } from '@/components/durability/eviction-warning'
import { InstallPwaCard } from '@/components/durability/install-pwa-card'

export function DurabilitySection() {
  return (
    <section className="flex flex-col gap-4" data-testid="durability-section">
      <div className="tap-card flex items-center justify-between p-5">
        <h2 className="text-lg font-semibold">Durability</h2>
        <DurabilityBadge />
      </div>
      <EvictionWarning />
      <BackupSettingsCard />
      <InstallPwaCard />
    </section>
  )
}
