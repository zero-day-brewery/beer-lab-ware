// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsView } from '@/components/diagnostics/diagnostics-view'
import { db } from '@/lib/db/schema'
import * as collectMod from '@/lib/diagnostics/collect-diagnostics'

describe('DiagnosticsView', () => {
  beforeEach(async () => {
    await db.open()
    for (const t of db.tables) await t.clear() // empty/evicted DB
  })
  afterEach(async () => {
    vi.restoreAllMocks() // drop the collectDiagnostics spy the quota-bar case installs
    for (const t of db.tables) await t.clear()
  })

  it('renders every read-only section on an empty DB without throwing', async () => {
    render(<DiagnosticsView />)
    await waitFor(() => expect(screen.getByTestId('diag-database')).toBeInTheDocument())
    expect(screen.getByTestId('diag-storage')).toBeInTheDocument()
    expect(screen.getByTestId('diag-backup')).toBeInTheDocument()
    expect(screen.getByTestId('diag-build')).toBeInTheDocument()
    expect(screen.getByTestId('diag-errorlog')).toBeInTheDocument()
    // reused E1/E2 primitives are composed, not re-implemented
    expect(screen.getByTestId('durability-badge')).toBeInTheDocument()
    expect(screen.getByTestId('backup-settings-card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy diagnostics/i })).toBeInTheDocument()
  })

  it('lists appMeta among the tables (15 expected after v9 yeastLots) and shows verno 10', async () => {
    render(<DiagnosticsView />)
    await waitFor(() => expect(screen.getByTestId('diag-database')).toBeInTheDocument())
    expect(screen.getByTestId('diag-table-appMeta')).toBeInTheDocument()
    expect(screen.getByTestId('diag-table-recipes')).toBeInTheDocument()
    expect(screen.getByTestId('diag-verno')).toHaveTextContent('10')
  })

  it('shows the SW state and build version (build-time stamp)', async () => {
    render(<DiagnosticsView />)
    await waitFor(() => expect(screen.getByTestId('diag-build')).toBeInTheDocument())
    // jsdom has no serviceWorker → unsupported; version.ts dev fallback
    expect(screen.getByTestId('diag-sw')).toHaveTextContent(/unsupported/i)
    expect(screen.getByTestId('diag-build')).toHaveTextContent('0.0.0-dev')
  })

  it('renders the storage quota bar (percent width) when an estimate is present', async () => {
    // jsdom exposes no navigator.storage, so the REAL adapter returns estimate:null
    // (the "Storage estimate unavailable" branch the other cases exercise). Spy the
    // adapter to return a populated estimate and assert the quota-bar branch + the
    // percent math (percentUsed 0.9 → Math.round(0.9*100) = 90 → width '90%').
    // vi.spyOn on the module namespace patches the live binding DiagnosticsView
    // imports, so the component calls the mock. Restored in afterEach.
    const snapshot: collectMod.DiagnosticsSnapshot = {
      build: { version: '0.0.0-dev', sha: 'local', builtAt: '' },
      db: { verno: 8, open: true, tables: [{ name: 'recipes', count: 0 }] },
      storage: {
        persistence: 'persisted',
        estimate: { usageBytes: 900, quotaBytes: 1000, percentUsed: 0.9 },
      },
      backup: { lastBackupAt: null, ageDays: null, freshness: 'critical', method: null },
      sw: { supported: false, registered: false, scope: null, precacheVersion: null },
      ring: [],
    }
    vi.spyOn(collectMod, 'collectDiagnostics').mockResolvedValue(snapshot)
    render(<DiagnosticsView />)
    const bar = await screen.findByTestId('diag-quota-bar')
    expect(bar).toHaveStyle({ width: '90%' })
  })

  it('renders one row per error-ring entry when the ring is populated', async () => {
    // Every other case has an empty ring (the "No errors recorded" branch); this
    // exercises the snap.ring.map(...) → diag-ring-entry branch with real entries.
    const snapshot: collectMod.DiagnosticsSnapshot = {
      build: { version: '0.0.0-dev', sha: 'local', builtAt: '' },
      db: { verno: 8, open: true, tables: [{ name: 'recipes', count: 0 }] },
      storage: { persistence: 'unsupported', estimate: null },
      backup: { lastBackupAt: null, ageDays: null, freshness: 'critical', method: null },
      sw: { supported: false, registered: false, scope: null, precacheVersion: null },
      ring: [
        { scope: 'window.error', message: 'boom one', at: '2026-07-07T00:00:00.000Z' },
        { scope: 'unhandledrejection', message: 'boom two', at: '2026-07-07T00:00:01.000Z' },
      ],
    }
    vi.spyOn(collectMod, 'collectDiagnostics').mockResolvedValue(snapshot)
    render(<DiagnosticsView />)
    await waitFor(() => expect(screen.getByTestId('diag-errorlog')).toBeInTheDocument())
    const entries = screen.getAllByTestId('diag-ring-entry')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('[window.error]')
    expect(entries[0]).toHaveTextContent('boom one')
    expect(entries[1]).toHaveTextContent('[unhandledrejection]')
    expect(entries[1]).toHaveTextContent('boom two')
  })
})
