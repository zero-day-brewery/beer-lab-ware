'use client'
import { useEffect, useState } from 'react'
import { DbRecoveryPanel } from '@/components/shell/db-recovery-panel'
import { type DbOpenResult, openDb } from '@/lib/db/open'
import { installGlobalErrorHooks } from '@/lib/diagnostics/error-log'

export function DbGate({ children }: { children: React.ReactNode }) {
  const [result, setResult] = useState<DbOpenResult | null>(null)

  useEffect(() => {
    installGlobalErrorHooks()
    let cancelled = false
    openDb().then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (result === null) {
    return (
      <div data-testid="db-gate-skeleton" className="flex min-h-[40vh] items-center justify-center">
        <span className="opacity-60">Loading your brewery…</span>
      </div>
    )
  }
  if (result.status === 'ok') return <>{children}</>
  return <DbRecoveryPanel result={result} />
}
