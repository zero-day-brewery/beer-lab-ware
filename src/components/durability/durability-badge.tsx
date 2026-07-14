'use client'
import { useDurability } from '@/hooks/use-durability'
import type { PersistenceState } from '@/lib/storage/durability'

const BADGE: Record<PersistenceState, { icon: string; copy: string }> = {
  persisted: { icon: '🟢', copy: 'Protected from cleanup' },
  transient: { icon: '🟠', copy: 'Best-effort — install or back up' },
  unsupported: { icon: '⚪', copy: 'Storage durability unknown' },
}

export function DurabilityBadge() {
  const { state } = useDurability()
  const b = BADGE[state]
  return (
    <span
      className="inline-flex items-center gap-2 text-sm"
      data-testid="durability-badge"
      data-state={state}
    >
      <span aria-hidden>{b.icon}</span>
      {b.copy}
    </span>
  )
}
