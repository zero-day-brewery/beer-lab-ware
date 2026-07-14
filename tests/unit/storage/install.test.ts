// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getInstallState,
  isInstallSuppressed,
  isSafari,
  markInstallDismissed,
  promptInstall,
  recordSession,
} from '@/lib/storage/install'

const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

describe('install helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('isSafari true for a Safari UA, false for Chrome', () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA })
    expect(isSafari()).toBe(true)
    vi.stubGlobal('navigator', { userAgent: CHROME_UA })
    expect(isSafari()).toBe(false)
  })

  it('getInstallState → installed when display-mode is standalone', () => {
    vi.stubGlobal('navigator', { userAgent: CHROME_UA, standalone: false })
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') }))
    expect(getInstallState()).toBe('installed')
  })

  it('getInstallState → manual-safari for Safari, not standalone, no stashed prompt', () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA, standalone: false })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(getInstallState()).toBe('manual-safari')
  })

  it('promptInstall returns false when no prompt was stashed', async () => {
    expect(await promptInstall()).toBe(false)
  })
})

const DAY = 86_400_000

describe('install suppression policy (spec E1.6)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('recordSession advances the counter once per browser session', () => {
    recordSession()
    expect(localStorage.getItem('beer-lab-ware-session-count')).toBe('1')
    recordSession() // same session → sessionStorage guard blocks a second bump
    expect(localStorage.getItem('beer-lab-ware-session-count')).toBe('1')
    sessionStorage.clear() // simulate a new tab/session
    recordSession()
    expect(localStorage.getItem('beer-lab-ware-session-count')).toBe('2')
  })

  it('is suppressed before the engagement gate (fewer than 2 sessions)', () => {
    localStorage.setItem('beer-lab-ware-session-count', '1')
    expect(isInstallSuppressed()).toBe(true)
  })

  it('is NOT suppressed once engaged (>=2 sessions) with no dismiss', () => {
    localStorage.setItem('beer-lab-ware-session-count', '2')
    expect(isInstallSuppressed()).toBe(false)
  })

  it('is suppressed during the ~30-day dismiss cooldown, then re-appears after it', () => {
    localStorage.setItem('beer-lab-ware-session-count', '2')
    const now = Date.parse('2026-07-07T00:00:00.000Z')
    markInstallDismissed(now)
    expect(isInstallSuppressed(now + 5 * DAY)).toBe(true) // within cooldown
    expect(isInstallSuppressed(now + 31 * DAY)).toBe(false) // cooldown elapsed
  })
})
