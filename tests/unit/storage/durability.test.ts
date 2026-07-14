import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getPersistenceState,
  getStorageEstimate,
  isPersistenceSupported,
} from '@/lib/storage/durability'

describe('durability — SSR / unsupported path', () => {
  it('reports unsupported when navigator.storage is absent', async () => {
    expect(isPersistenceSupported()).toBe(false)
    expect(await getPersistenceState()).toBe('unsupported')
    expect(await getStorageEstimate()).toBeNull()
  })
})

describe('durability — stubbed navigator.storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('computes percentUsed from usage/quota', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: async () => true,
        persisted: async () => true,
        estimate: async () => ({ usage: 200, quota: 1000 }),
      },
    })
    expect(isPersistenceSupported()).toBe(true)
    expect(await getPersistenceState()).toBe('persisted')
    expect(await getStorageEstimate()).toEqual({
      usageBytes: 200,
      quotaBytes: 1000,
      percentUsed: 0.2,
    })
  })

  it('percentUsed is 0 when quota is 0 (no divide-by-zero)', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 0, quota: 0 }) } })
    expect((await getStorageEstimate())?.percentUsed).toBe(0)
  })
})
