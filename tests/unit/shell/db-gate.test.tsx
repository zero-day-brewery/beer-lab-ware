// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOpenResult } from '@/lib/db/open'

const openDb = vi.fn<() => Promise<DbOpenResult>>()
const salvageDump = vi.fn().mockResolvedValue(new Blob(['{}'], { type: 'application/json' }))
const resetDb = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/db/open', () => ({
  openDb: () => openDb(),
  salvageDump: (...args: unknown[]) => salvageDump(...args),
  resetDb: (...args: unknown[]) => resetDb(...args),
}))
vi.mock('@/lib/diagnostics/error-log', () => ({
  installGlobalErrorHooks: vi.fn(),
  getDiagnostics: () => ({ appVersion: '0.0.0-dev', verno: 8, ring: [], userAgent: '' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { DbGate } from '@/components/shell/db-gate'
import { DbRecoveryPanel } from '@/components/shell/db-recovery-panel'

describe('DbGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows a skeleton while the probe is pending', () => {
    openDb.mockReturnValue(new Promise(() => {}))
    render(
      <DbGate>
        <div data-testid="gated-child" />
      </DbGate>,
    )
    expect(screen.getByTestId('db-gate-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('gated-child')).toBeNull()
  })

  it('renders children when the probe returns ok', async () => {
    openDb.mockResolvedValue({ status: 'ok', verno: 8 })
    render(
      <DbGate>
        <div data-testid="gated-child" />
      </DbGate>,
    )
    await waitFor(() => expect(screen.getByTestId('gated-child')).toBeInTheDocument())
  })

  it('renders the recovery panel on a corrupt probe', async () => {
    openDb.mockResolvedValue({ status: 'corrupt', error: new Error('x') })
    render(
      <DbGate>
        <div data-testid="gated-child" />
      </DbGate>,
    )
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByTestId('gated-child')).toBeNull()
  })
})

describe('DbRecoveryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('corrupt: export + reset (double-confirm, export-first) + copy diagnostics', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DbRecoveryPanel result={{ status: 'corrupt', error: new Error('x') }} />)
    expect(screen.getByRole('button', { name: /copy diagnostics/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    await waitFor(() => expect(resetDb).toHaveBeenCalledTimes(1))
    expect(salvageDump).toHaveBeenCalled() // export-first before reset
  })

  it('corrupt: cancelling the confirm does NOT reset', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DbRecoveryPanel result={{ status: 'corrupt', error: new Error('x') }} />)
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    await Promise.resolve()
    expect(resetDb).not.toHaveBeenCalled()
  })

  it('version-newer: offers export + reload but NO reset (never overwrite)', () => {
    render(<DbRecoveryPanel result={{ status: 'version-newer' }} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull()
  })

  it('blocked: offers only reload', () => {
    render(<DbRecoveryPanel result={{ status: 'blocked' }} />)
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
  })
})
