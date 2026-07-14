'use client'
import { useDurability } from '@/hooks/use-durability'
import { isSafari } from '@/lib/storage/install'

export function EvictionWarning() {
  const { state, estimate } = useDurability()
  const nearQuota = (estimate?.percentUsed ?? 0) >= 0.8
  if (state === 'persisted' && !nearQuota) return null
  const pct = Math.round((estimate?.percentUsed ?? 0) * 100)
  return (
    <div
      className="tap-card border-amber-500/40 p-4 text-sm"
      role="status"
      data-testid="eviction-warning"
    >
      {isSafari() ? (
        <p>
          Safari clears unopened site data after 7 days. Add this app to your Dock to keep your
          brewery safe.
        </p>
      ) : (
        <p>
          Your data isn't marked persistent yet. Keep a recent backup so nothing is lost to browser
          cleanup.
        </p>
      )}
      {nearQuota && estimate ? (
        <div className="mt-2">
          <div className="h-2 w-full rounded bg-border">
            <div className="h-2 rounded bg-amber-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{pct}% of estimated storage used</p>
        </div>
      ) : null}
    </div>
  )
}
