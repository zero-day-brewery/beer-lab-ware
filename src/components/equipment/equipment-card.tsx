'use client'
import Link from 'next/link'
import { useDisplayUnits } from '@/hooks/use-display-units'
import { formatForInput, unitLabel } from '@/lib/brewing/convert/display-units'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'

export function EquipmentCard({ profile }: { profile: EquipmentProfile }) {
  const units = useDisplayUnits()
  return (
    <Link
      href={`/equipment/edit/?id=${profile.id}`}
      className="tap-card block p-5 text-card-foreground"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-snug">{profile.name}</h3>
        {profile.isDefault && (
          <span className="cond cond-good shrink-0">
            <span className="dot" aria-hidden="true" />
            default
          </span>
        )}
      </div>
      <p className="mt-2 font-mono text-sm" style={{ color: 'var(--malt, var(--primary))' }}>
        {formatForInput(profile.kettleVolume_L, 'volume', units)}
        {unitLabel('volume', units)} kettle · {profile.brewhouseEfficiency_pct}% eff
      </p>
      <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
        IBU: {profile.ibuFormula} · SRM: {profile.srmFormula}
      </p>
    </Link>
  )
}
