'use client'
import { useEffect } from 'react'
import { CopyDiagnosticsButton } from '@/components/shell/copy-diagnostics-button'
import { recordError } from '@/lib/diagnostics/error-log'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    recordError('route', error)
  }, [error])

  return (
    <section className="tap-card m-6 flex max-w-lg flex-col gap-4 p-6" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm opacity-80">
        This page hit an error, but your saved brewery data is safe. Try again, or head back.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <a href="/recipes/" className="btn-ghost">
          Back to recipes
        </a>
        <CopyDiagnosticsButton />
      </div>
    </section>
  )
}
