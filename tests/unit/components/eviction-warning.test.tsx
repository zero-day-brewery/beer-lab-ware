// tests/unit/components/eviction-warning.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvictionWarning } from '@/components/durability/eviction-warning'

describe('EvictionWarning', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing when storage is persisted and under quota', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Chrome',
      storage: {
        persist: async () => true,
        persisted: async () => true,
        estimate: async () => ({ usage: 1, quota: 100 }),
      },
    })
    const { container } = render(<EvictionWarning />)
    // useDurability starts at 'unsupported' then resolves to 'persisted' → unmounts.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders the warning bar when not persisted / near quota', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Chrome',
      storage: {
        persist: async () => false,
        persisted: async () => false,
        estimate: async () => ({ usage: 90, quota: 100 }),
      },
    })
    render(<EvictionWarning />)
    // Wait on the quota copy specifically — it only appears after the async
    // estimate resolves (the warning testid is present from the initial render).
    await waitFor(() =>
      expect(screen.getByText('90% of estimated storage used')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('eviction-warning')).toBeInTheDocument()
  })
})
