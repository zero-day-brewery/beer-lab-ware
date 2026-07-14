'use client'
import { toast } from 'sonner'
import { getDiagnostics } from '@/lib/diagnostics/error-log'

/**
 * `payload`, when provided, is copied verbatim (JSON-stringified) — the diagnostics
 * page passes its full on-screen snapshot so counts/storage/backup/build/SW travel
 * with the copy. When omitted the button falls back to the sync, DB-free
 * getDiagnostics() so the error-boundary usages (error.tsx / global-error /
 * db-recovery-panel) stay crash-safe: no DB/collect access on a crash path.
 */
export function CopyDiagnosticsButton({ payload }: { payload?: unknown }) {
  const onCopy = async () => {
    try {
      const data = payload !== undefined ? payload : getDiagnostics()
      await navigator.clipboard?.writeText(JSON.stringify(data, null, 2))
      toast.success('Diagnostics copied to clipboard')
    } catch {
      toast.error('Could not copy diagnostics')
    }
  }
  return (
    <button type="button" onClick={onCopy} className="btn-ghost">
      Copy diagnostics
    </button>
  )
}
