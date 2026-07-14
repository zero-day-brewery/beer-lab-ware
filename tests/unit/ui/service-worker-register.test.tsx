// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceWorkerRegister } from '@/components/shell/service-worker-register'

const flush = () => new Promise((r) => setTimeout(r, 50))

describe('ServiceWorkerRegister', () => {
  let register: ReturnType<typeof vi.fn>
  let getRegistrations: ReturnType<typeof vi.fn>
  let unregister: ReturnType<typeof vi.fn>

  beforeEach(() => {
    unregister = vi.fn()
    register = vi.fn().mockResolvedValue({})
    getRegistrations = vi.fn().mockResolvedValue([{ unregister }])
    Object.defineProperty(global.navigator, 'serviceWorker', {
      value: { register, getRegistrations },
      configurable: true,
    })
    Object.defineProperty(global, 'caches', {
      value: { keys: vi.fn().mockResolvedValue(['stale-cache']), delete: vi.fn() },
      configurable: true,
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('registers /sw.js in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(<ServiceWorkerRegister />)
    await flush()
    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('does NOT register in development — unregisters any stale worker + clears caches instead', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<ServiceWorkerRegister />)
    await flush()
    expect(register).not.toHaveBeenCalled()
    expect(getRegistrations).toHaveBeenCalled()
    expect(unregister).toHaveBeenCalled()
  })

  it('does not throw if serviceWorker is undefined', () => {
    Object.defineProperty(global.navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    })
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow()
  })
})
