// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The panel imports these but never runs them on render; stub so no real IDB.
vi.mock('@/lib/db/open', () => ({ salvageDump: vi.fn(), resetDb: vi.fn() }))
vi.mock('@/components/shell/copy-diagnostics-button', () => ({
  CopyDiagnosticsButton: () => <button type="button">Copy diagnostics</button>,
}))

import { DbRecoveryPanel } from '@/components/shell/db-recovery-panel'

describe('DbRecoveryPanel', () => {
  it('offers a salvage export on the unknown-error branch — the catch-all must not be reload-only', () => {
    // `unknown` is classifyOpenError's fallback (and the open-timeout case). A
    // user whose DB will not open needs SOME way to export their data; leaving
    // this branch reload-only strands recoverable brew logs behind a dead end.
    render(<DbRecoveryPanel result={{ status: 'unknown', error: new Error('boom') }} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('still offers export on the corrupt branch (regression guard)', () => {
    render(<DbRecoveryPanel result={{ status: 'corrupt', error: new Error('x') }} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })
})
