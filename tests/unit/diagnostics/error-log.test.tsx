// @vitest-environment jsdom

import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/schema'
import {
  clearDiagnosticsRing,
  getDiagnostics,
  installGlobalErrorHooks,
  recordError,
  reportDbError,
} from '@/lib/diagnostics/error-log'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('error-log', () => {
  beforeEach(() => {
    clearDiagnosticsRing()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('recordError pushes a scoped entry with a message + timestamp', () => {
    recordError('recipes', new Error('boom'))
    const ring = getDiagnostics().ring
    expect(ring).toHaveLength(1)
    expect(ring[0].scope).toBe('recipes')
    expect(ring[0].message).toBe('boom')
    expect(typeof ring[0].at).toBe('string')
  })

  it('coerces a non-Error value to a string message', () => {
    recordError('x', 'plain string failure')
    expect(getDiagnostics().ring[0].message).toBe('plain string failure')
  })

  it('bounds the ring at 50 (drops oldest, keeps newest)', () => {
    for (let i = 0; i < 60; i++) recordError('s', new Error(`e${i}`))
    const ring = getDiagnostics().ring
    expect(ring).toHaveLength(50)
    expect(ring[0].message).toBe('e10')
    expect(ring[49].message).toBe('e59')
  })

  it('reportDbError records AND toasts a friendly message', () => {
    reportDbError('settings', new Error('VersionError'))
    expect(getDiagnostics().ring).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('settings')
  })

  it('coalesces rapid db-error toasts into one (stable id) but records each in the ring', () => {
    // A mid-session DB failure fans out to 5-7 store subscriptions that each call
    // reportDbError near-simultaneously. Every error must still be recorded, but
    // the user should see ONE toast — sonner dedups by a shared toast id.
    reportDbError('recipes', new Error('boom1'))
    reportDbError('batches', new Error('boom2'))
    expect(getDiagnostics().ring).toHaveLength(2) // both recorded in the ring
    const errorMock = toast.error as ReturnType<typeof vi.fn>
    expect(errorMock).toHaveBeenCalledTimes(2)
    expect(errorMock.mock.calls[0][1]).toMatchObject({ id: 'db-error' })
    expect(errorMock.mock.calls[1][1]).toMatchObject({ id: 'db-error' })
  })

  it('getDiagnostics reports appVersion, an open verno, and a userAgent', async () => {
    await db.open()
    const d = getDiagnostics()
    expect(d.appVersion).toBe('0.0.0-dev')
    expect(d.verno).toBe(10)
    expect(typeof d.userAgent).toBe('string')
  })

  it('installGlobalErrorHooks is idempotent and captures window errors', () => {
    installGlobalErrorHooks()
    installGlobalErrorHooks()
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('global-boom'), message: 'global-boom' }),
    )
    const ring = getDiagnostics().ring
    expect(ring.some((e) => e.message === 'global-boom')).toBe(true)
  })
})
