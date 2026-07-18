// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncStatusSection } from '@/components/diagnostics/sync-status-section'
import { DUMP_VERSION } from '@/lib/db/backup'
import { db } from '@/lib/db/schema'
import { syncMetaRepo } from '@/lib/sync/sync-meta'

const realFetch = globalThis.fetch

function healthResponse(supportedDumpVersions: number[], daemonVersion = '0.1.0'): Response {
  return new Response(JSON.stringify({ ok: true, daemonVersion, supportedDumpVersions }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('SyncStatusSection (Diagnostics)', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
  })
  afterEach(async () => {
    await db.appMeta.clear()
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('unconfigured: points at Settings → Sync and NEVER probes the network', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    render(<SyncStatusSection />)
    await waitFor(() =>
      expect(screen.getByTestId('diag-sync-service')).toHaveTextContent(/not configured/i),
    )
    expect(screen.getByTestId('diag-sync-device')).not.toHaveTextContent('—') // device id still shown
    expect(screen.getByTestId('diag-sync-last')).toHaveTextContent('never')
    expect(screen.getByTestId('diag-sync-outcome')).toHaveTextContent(/no sync attempted/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('configured + healthy + auth ok: reachable with daemon version, compatible, token accepted', async () => {
    await syncMetaRepo.setServerUrl('https://sync.example.com')
    await syncMetaRepo.setToken('tok-diag')
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) return healthResponse([DUMP_VERSION])
      return new Response(null, { status: 204, headers: { etag: '"empty"' } })
    }) as unknown as typeof fetch

    render(<SyncStatusSection />)
    await waitFor(() =>
      expect(screen.getByTestId('diag-sync-reach')).toHaveTextContent('reachable (daemon v0.1.0)'),
    )
    expect(screen.getByTestId('diag-sync-service')).toHaveTextContent('https://sync.example.com')
    expect(screen.getByTestId('diag-sync-compat')).toHaveTextContent(
      `compatible (app writes dump v${DUMP_VERSION})`,
    )
    expect(screen.getByTestId('diag-sync-auth')).toHaveTextContent('token accepted')
    // The token itself is never rendered anywhere.
    expect(document.body.textContent).not.toContain('tok-diag')
  })

  it('flags a rejected token (401) distinctly from unreachability', async () => {
    await syncMetaRepo.setServerUrl('https://sync.example.com')
    await syncMetaRepo.setToken('tok-bad')
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) return healthResponse([DUMP_VERSION])
      return new Response('{"error":"unauthorized"}', { status: 401 })
    }) as unknown as typeof fetch

    render(<SyncStatusSection />)
    await waitFor(() =>
      expect(screen.getByTestId('diag-sync-auth')).toHaveTextContent(/rejected \(401\)/i),
    )
    expect(screen.getByTestId('diag-sync-reach')).toHaveTextContent(/reachable/)
  })

  it('surfaces a dump-version mismatch with the update-the-server instruction', async () => {
    await syncMetaRepo.setServerUrl('https://sync.example.com')
    await syncMetaRepo.setToken('tok-diag')
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) return healthResponse([1, 2, 8], '0.0.9')
      return new Response(null, { status: 204, headers: { etag: '"empty"' } })
    }) as unknown as typeof fetch

    render(<SyncStatusSection />)
    await waitFor(() =>
      expect(screen.getByTestId('diag-sync-compat')).toHaveTextContent(
        `server accepts up to v8, this app writes v${DUMP_VERSION} — update the server`,
      ),
    )
  })

  it('reports unreachable when the daemon is down, and shows the last recorded outcome', async () => {
    await syncMetaRepo.setServerUrl('https://down.example.com')
    await syncMetaRepo.setToken('tok-diag')
    await syncMetaRepo.setLastSyncAt('2026-07-15T10:00:00.000Z')
    await syncMetaRepo.setLastOutcome({
      at: '2026-07-15T10:00:00.000Z',
      mode: 'two-way',
      ok: true,
      message: 'Sync complete (two-way) — pushed · 12 rows',
    })
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    render(<SyncStatusSection />)
    await waitFor(() =>
      expect(screen.getByTestId('diag-sync-reach')).toHaveTextContent(/unreachable/i),
    )
    expect(screen.getByTestId('diag-sync-last')).toHaveTextContent('2026-07-15 10:00:00')
    expect(screen.getByTestId('diag-sync-outcome')).toHaveTextContent(/✓ .*two-way.*12 rows/)
  })
})
