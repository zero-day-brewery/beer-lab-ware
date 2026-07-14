// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const sessionRef = vi.hoisted(() => ({ current: null as unknown }))
// Stable (hoisted) loadActive spy — the mount effect in SystemView now calls it,
// and a stable ref keeps the [loadActive] effect from re-firing each render.
const loadActive = vi.hoisted(() => vi.fn())
vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({ session: sessionRef.current, loadActive }),
}))

import { SystemView } from '@/components/system/system-view'

afterEach(() => {
  sessionRef.current = null
  vi.clearAllMocks()
})

describe('SystemView states', () => {
  it('idle: shows a Start a brew CTA and no resume card', async () => {
    render(<SystemView />)
    expect(await screen.findByRole('button', { name: /Start a brew/i })).toBeInTheDocument()
    expect(screen.queryByText(/Resume —/)).not.toBeInTheDocument()
  })

  it('calls loadActive once on mount to hydrate the active-session pointer', async () => {
    render(<SystemView />)
    // Wait for the post-mount render so the mount effects have committed.
    await screen.findByRole('button', { name: /Start a brew/i })
    expect(loadActive).toHaveBeenCalledTimes(1)
  })

  it('running session: shows the Return to runner ribbon and a Resume card', async () => {
    sessionRef.current = {
      id: 'sess-9',
      recipeName: 'WC IPA',
      lifecycle: 'running',
      stageId: 'hotside',
      cursor: 'ramp-to-boil',
      resolvedSteps: ['a', 'ramp-to-boil'],
      steps: {},
      choices: {},
      timers: [],
      manualVersion: 1,
      startedAt: '',
      updatedAt: '',
      schemaVersion: 1,
    }
    render(<SystemView />)
    expect(await screen.findByRole('button', { name: /Return to runner/i })).toBeInTheDocument()
    expect(screen.getByText(/Resume —/)).toBeInTheDocument()
  })
})
