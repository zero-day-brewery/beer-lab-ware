// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncSection } from '@/components/settings/sync-section'
import { backupService, DUMP_VERSION } from '@/lib/db/backup'
import { db } from '@/lib/db/schema'
import { runBackup } from '@/lib/storage/backup-run'
import * as syncClientMod from '@/lib/sync/sync-client'
import { syncMetaRepo } from '@/lib/sync/sync-meta'
import { HttpSyncTransport } from '@/lib/sync/transport'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const realFetch = globalThis.fetch

describe('SyncSection (Settings → Sync)', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
  })
  afterEach(async () => {
    await db.appMeta.clear()
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('renders URL + token fields (token is a password input) and the two actions', async () => {
    render(<SyncSection />)
    expect(await screen.findByLabelText('Sync server URL')).toBeInTheDocument()
    const tokenInput = screen.getByLabelText('Device token')
    expect(tokenInput).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
  })

  it('explains WHY a plain-http non-localhost URL is rejected, and accepts http://localhost', async () => {
    render(<SyncSection />)
    const urlInput = await screen.findByLabelText('Sync server URL')

    fireEvent.change(urlInput, { target: { value: 'http://brewery.example.com' } })
    expect(await screen.findByTestId('sync-url-error')).toHaveTextContent(/https:\/\/ required/i)
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()

    fireEvent.change(urlInput, { target: { value: 'http://localhost:8787' } })
    await waitFor(() => expect(screen.queryByTestId('sync-url-error')).toBeNull())
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled()
  })

  it('persists URL (normalized), token, and mode via the device-local appMeta repo', async () => {
    render(<SyncSection />)
    const urlInput = await screen.findByLabelText('Sync server URL')
    fireEvent.change(urlInput, { target: { value: 'https://brewery.example.com/' } })
    await waitFor(async () =>
      expect(await syncMetaRepo.serverUrl()).toBe('https://brewery.example.com'),
    )

    fireEvent.change(screen.getByLabelText('Device token'), { target: { value: 'tok-42' } })
    await waitFor(async () => expect(await syncMetaRepo.token()).toBe('tok-42'))

    fireEvent.click(screen.getByRole('radio', { name: /pull only/i }))
    await waitFor(async () => expect(await syncMetaRepo.mode()).toBe('pull-only'))
  })

  it('loads a previously stored config on mount', async () => {
    await syncMetaRepo.setServerUrl('https://stored.example.com')
    await syncMetaRepo.setToken('tok-stored')
    await syncMetaRepo.setMode('push-only')
    render(<SyncSection />)
    await waitFor(() =>
      expect(screen.getByLabelText('Sync server URL')).toHaveValue('https://stored.example.com'),
    )
    expect(screen.getByLabelText('Device token')).toHaveValue('tok-stored')
    expect(screen.getByRole('radio', { name: /push only/i })).toBeChecked()
  })

  it('Test connection: green with daemon version when compatible', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            daemonVersion: '0.1.0',
            supportedDumpVersions: [DUMP_VERSION],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch

    render(<SyncSection />)
    fireEvent.change(await screen.findByLabelText('Sync server URL'), {
      target: { value: 'https://ok.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    const ok = await screen.findByTestId('sync-test-ok')
    expect(ok).toHaveTextContent('daemon v0.1.0')
    expect(ok).toHaveTextContent(`dump v${DUMP_VERSION}`)
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://ok.example.com/health')
  })

  it('Test connection: explicit version-mismatch message when the daemon is older', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, daemonVersion: '0.0.9', supportedDumpVersions: [1, 2, 8] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch

    render(<SyncSection />)
    fireEvent.change(await screen.findByLabelText('Sync server URL'), {
      target: { value: 'https://old.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    const err = await screen.findByTestId('sync-test-error')
    expect(err).toHaveTextContent('accepts up to dump v8')
    expect(err).toHaveTextContent(`this app writes v${DUMP_VERSION}`)
    expect(err).toHaveTextContent('update the server')
  })

  it('Sync now wires the REAL pipeline: HttpSyncTransport from the stored URL/token, Bearer header, success toast', async () => {
    // First sync against an empty daemon: GET 204 + empty-sentinel etag, PUT 200.
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (!init?.method || init.method === 'GET') {
        return new Response(null, { status: 204, headers: { etag: '"empty"' } })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { etag: `"${'b'.repeat(64)}"` },
      })
    }) as unknown as typeof fetch

    render(<SyncSection />)
    fireEvent.change(await screen.findByLabelText('Sync server URL'), {
      target: { value: 'https://live.example.com' },
    })
    fireEvent.change(screen.getByLabelText('Device token'), { target: { value: 'tok-live' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))

    const { toast } = await import('sonner')
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const message = vi.mocked(toast.success).mock.calls[0][0] as string
    expect(message).toMatch(/sync complete/i)
    expect(message).toMatch(/pushed/)

    // Transport hit the configured base URL with the Bearer token on both legs.
    expect(calls.map((c) => c.url)).toEqual([
      'https://live.example.com/state',
      'https://live.example.com/state',
    ])
    for (const c of calls) {
      const headers = (c.init?.headers ?? {}) as Record<string, string>
      expect(headers.authorization).toBe('Bearer tok-live')
    }
    // The PUT carried the mandatory If-Match precondition (empty-store bootstrap).
    const putHeaders = (calls[1].init?.headers ?? {}) as Record<string, string>
    expect(putHeaders['if-match']).toBe('"empty"')

    // The outcome was recorded for diagnostics.
    const outcome = await syncMetaRepo.lastOutcome()
    expect(outcome).toMatchObject({ ok: true, mode: 'two-way' })
    expect(await syncMetaRepo.lastSyncAt()).toBeTruthy()
  })

  it('Sync now passes the selected mode, the production runBackup snapshot, and the app backupService to syncOnce', async () => {
    const syncSpy = vi.spyOn(syncClientMod, 'syncOnce').mockResolvedValue({
      pulled: true,
      pushed: false,
      merged: true,
      lastSyncAt: '2026-07-16T00:00:00.000Z',
      counts: { recipes: 2 },
    })
    render(<SyncSection />)
    fireEvent.change(await screen.findByLabelText('Sync server URL'), {
      target: { value: 'https://live.example.com' },
    })
    fireEvent.change(screen.getByLabelText('Device token'), { target: { value: 'tok-live' } })
    fireEvent.click(screen.getByRole('radio', { name: /pull only/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))

    await waitFor(() => expect(syncSpy).toHaveBeenCalledTimes(1))
    const deps = syncSpy.mock.calls[0][0]
    expect(deps.mode).toBe('pull-only')
    expect(deps.snapshot).toBe(runBackup) // the E1 production snapshot fn, not a reimplementation
    expect(deps.backup).toBe(backupService)
    expect(deps.transport).toBeInstanceOf(HttpSyncTransport)
  })

  it('a failed sync surfaces a human message with 401 context — and NEVER the token', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 401 }),
    ) as unknown as typeof fetch

    render(<SyncSection />)
    fireEvent.change(await screen.findByLabelText('Sync server URL'), {
      target: { value: 'https://live.example.com' },
    })
    fireEvent.change(screen.getByLabelText('Device token'), { target: { value: 'tok-hush' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))

    const { toast } = await import('sonner')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = vi.mocked(toast.error).mock.calls[0][0] as string
    expect(message).toMatch(/401/)
    expect(message).not.toContain('tok-hush')

    const outcome = await syncMetaRepo.lastOutcome()
    expect(outcome).toMatchObject({ ok: false })
    expect(outcome?.message).not.toContain('tok-hush')
  })

  it('scrubs token material out of any unexpected error message (defense-in-depth)', async () => {
    vi.spyOn(syncClientMod, 'syncOnce').mockRejectedValue(
      new Error('exploded while sending Bearer tok-hush somewhere'),
    )
    render(<SyncSection />)
    fireEvent.change(await screen.findByLabelText('Sync server URL'), {
      target: { value: 'https://live.example.com' },
    })
    fireEvent.change(screen.getByLabelText('Device token'), { target: { value: 'tok-hush' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))

    const { toast } = await import('sonner')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = vi.mocked(toast.error).mock.calls[0][0] as string
    expect(message).not.toContain('tok-hush')
    expect(message).toContain('[token]')
  })

  it('offers all three modes in the Advanced disclosure with one-line explanations', async () => {
    render(<SyncSection />)
    await screen.findByLabelText('Sync server URL')
    expect(screen.getByRole('radio', { name: /two-way/i })).toBeChecked() // the default
    expect(screen.getByRole('radio', { name: /pull only.*phone follows/i })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /push only.*desktop is canonical/i }),
    ).toBeInTheDocument()
  })
})
