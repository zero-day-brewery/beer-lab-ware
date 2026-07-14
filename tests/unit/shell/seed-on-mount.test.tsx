// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const reportDbError = vi.fn()
const seedDefaults = vi.fn()
vi.mock('@/lib/diagnostics/error-log', () => ({
  reportDbError: (...a: unknown[]) => reportDbError(...a),
}))
vi.mock('@/lib/db/seed', () => ({ seedDefaults: () => seedDefaults() }))

import { SeedOnMount } from '@/components/shell/seed-on-mount'

describe('SeedOnMount error routing', () => {
  afterEach(() => vi.clearAllMocks())

  it('routes a failed seed to reportDbError (no silent console.warn)', async () => {
    seedDefaults.mockRejectedValue(new Error('seed-boom'))
    render(<SeedOnMount />)
    await new Promise((r) => setTimeout(r, 20))
    expect(reportDbError).toHaveBeenCalledWith('seed', expect.any(Error))
  })
})
