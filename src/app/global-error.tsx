'use client'
import { useEffect } from 'react'
import { recordError } from '@/lib/diagnostics/error-log'

// Root-layout crash net: no theme/token CSS is available here, so it ships its
// own <html><body> with inline on-brand dark colors. No `metadata` export.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    recordError('global', error)
  }, [error])

  return (
    <html lang="en">
      <head>
        <title>Something went wrong</title>
      </head>
      <body
        style={{
          background: '#171310',
          color: '#f3ece2',
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
        }}
      >
        <div style={{ maxWidth: '32rem', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <p style={{ opacity: 0.8, marginBottom: '1.25rem' }}>
            The app hit a fatal error. Your saved data is stored locally and is not affected. Reload
            to recover.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#f3ece2',
              color: '#171310',
              border: 'none',
              borderRadius: '0.4rem',
              padding: '0.6rem 1rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
