// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyLocalSnapshot, captureLocalSnapshot } from '@/lib/storage/local-state'

describe('local-state snapshot', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('captures the fermenter board key', () => {
    localStorage.setItem('brew-system-flow', '{"fermenters":[]}')
    const snap = captureLocalSnapshot()
    expect(snap.keys['brew-system-flow']).toBe('{"fermenters":[]}')
    expect(typeof snap.capturedAt).toBe('string')
  })

  it('excludes theme, companion (secret) and pointer keys', () => {
    localStorage.setItem('brew-system-flow', 'board')
    localStorage.setItem('brew-theme', 'matrix')
    localStorage.setItem('brew-companion', '{"apiKey":"sk-secret"}')
    localStorage.setItem('brew-active-batch', 'id-1')
    localStorage.setItem('brew-session', 'id-2')
    const snap = captureLocalSnapshot()
    expect(Object.keys(snap.keys)).toEqual(['brew-system-flow'])
    expect(snap.keys).not.toHaveProperty('brew-companion')
  })

  it('round-trips: apply writes the board back', () => {
    applyLocalSnapshot({
      keys: { 'brew-system-flow': 'BOARD' },
      capturedAt: '2026-07-07T00:00:00.000Z',
    })
    expect(localStorage.getItem('brew-system-flow')).toBe('BOARD')
  })

  it('apply ignores non-tracked keys in a snapshot (never restores a secret)', () => {
    applyLocalSnapshot({ keys: { 'brew-companion': '{"apiKey":"sk"}' }, capturedAt: 'x' })
    expect(localStorage.getItem('brew-companion')).toBeNull()
  })

  it('returns an empty snapshot when localStorage is unavailable (SSR)', () => {
    const original = globalThis.localStorage
    delete (globalThis as { localStorage?: Storage }).localStorage
    expect(captureLocalSnapshot().keys).toEqual({})
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      configurable: true,
      writable: true,
    })
  })
})
