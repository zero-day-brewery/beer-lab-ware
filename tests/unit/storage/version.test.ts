import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// version.ts reads NEXT_PUBLIC_* at MODULE LOAD (Next injects them only at build
// time — see next.config.ts `env`). Verified 2026-07-07: the repo has no `.env*`
// file and vitest.config.ts declares no `env`, so process.env never carries these
// keys under vitest. This test is hermetic anyway — it deletes the three keys and
// re-imports version.ts so the dev fallbacks are asserted regardless of ambient env.
const KEYS = ['NEXT_PUBLIC_APP_VERSION', 'NEXT_PUBLIC_BUILD_SHA', 'NEXT_PUBLIC_BUILD_TIME'] as const

describe('version stamp', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    vi.resetModules() // force version.ts to re-evaluate its top-level consts
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('falls back to dev defaults when env is unset', async () => {
    const { APP_VERSION, BUILD_SHA, BUILD_TIME } = await import('@/lib/version')
    expect(APP_VERSION).toBe('0.0.0-dev')
    expect(BUILD_SHA).toBe('local')
    expect(BUILD_TIME).toBe('')
  })

  it('getAppVersion returns the three-field stamp', async () => {
    const { getAppVersion } = await import('@/lib/version')
    expect(getAppVersion()).toEqual({ version: '0.0.0-dev', sha: 'local', builtAt: '' })
  })
})
