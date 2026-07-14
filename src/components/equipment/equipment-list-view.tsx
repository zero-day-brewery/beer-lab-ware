'use client'
import Link from 'next/link'
import { useEquipmentStore } from '@/stores/equipment-store'
import { EquipmentCard } from './equipment-card'

export function EquipmentListView() {
  const { profiles, isLoading } = useEquipmentStore()
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="chip-icon mb-4 !h-16 !w-16 !text-4xl">🛠️</div>
        <h2 className="text-xl font-semibold">No equipment profiles yet</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Add your B40 Pro (or whatever you brew on) so recipes can use real numbers.
        </p>
        <Link href="/equipment/new" className="btn-primary mt-6">
          <span aria-hidden="true">＋</span>
          <span>New profile</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-6">
        <div>
          <span className="eyebrow">🛠️ Rig</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Equipment profiles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The brewhouse numbers your recipes calculate against.
          </p>
        </div>
        <Link href="/equipment/new" className="btn-primary">
          <span aria-hidden="true">＋</span>
          <span>New profile</span>
        </Link>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((p) => (
          <EquipmentCard key={p.id} profile={p} />
        ))}
      </div>
    </div>
  )
}
