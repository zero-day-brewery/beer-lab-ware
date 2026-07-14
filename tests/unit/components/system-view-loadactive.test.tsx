// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrewSession } from '@/lib/brewing/process/session'
import { sessionRepo } from '@/lib/db/repos/session'
import { db } from '@/lib/db/schema'
import { useSessionStore } from '@/stores/session-store'

// Only next/navigation is mocked — the session-store is the REAL store so this
// exercises the mount effect → loadActive() → adopt|clear path end-to-end.
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import { SystemView } from '@/components/system/system-view'

const STEP = 'prep-read-batch-numbers'

function makeSession(id: string, lifecycle: BrewSession['lifecycle']): BrewSession {
  return {
    id,
    recipeName: 'Test Brew',
    manualVersion: 1,
    lifecycle,
    stageId: 'prep',
    cursor: STEP,
    resolvedSteps: [STEP],
    steps: { [STEP]: { id: STEP, status: 'active', logs: [] } },
    choices: {},
    timers: [],
    startedAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    schemaVersion: 1,
  }
}

/** Read the persisted pointer straight out of localStorage. */
function persistedActiveId(): string | null | undefined {
  const raw = JSON.parse(localStorage.getItem('brew-session') ?? '{}')
  return raw?.state?.activeId
}

describe('SystemView — loadActive on mount', () => {
  beforeEach(async () => {
    useSessionStore.setState({ session: null, activeId: null, lastRejection: null })
    localStorage.clear()
    await db.brewSessions.clear()
  })
  afterEach(async () => {
    useSessionStore.setState({ session: null, activeId: null, lastRejection: null })
    await db.brewSessions.clear()
    vi.clearAllMocks()
  })

  it('a persisted RUNNING pointer rehydrates on mount → ribbon shows after reload', async () => {
    // Simulate a full reload: the body lives in Dexie, only the id "survived".
    await sessionRepo.save(makeSession('sess-running', 'running'))
    useSessionStore.setState({ activeId: 'sess-running' }) // session stays null

    render(<SystemView />)

    // Without the mount effect, session stays null → this ribbon never appears.
    expect(await screen.findByRole('button', { name: /Return to runner/i })).toBeInTheDocument()
    expect(useSessionStore.getState().session?.id).toBe('sess-running')
    expect(useSessionStore.getState().activeId).toBe('sess-running')
  })

  it('a persisted PAUSED pointer rehydrates on mount → paused ribbon shows', async () => {
    await sessionRepo.save(makeSession('sess-paused', 'paused'))
    useSessionStore.setState({ activeId: 'sess-paused' })

    render(<SystemView />)

    expect(await screen.findByText(/Paused —/)).toBeInTheDocument()
    expect(useSessionStore.getState().session?.lifecycle).toBe('paused')
  })

  it('a stale DONE pointer is cleared on mount → no ribbon, pointer gone', async () => {
    await sessionRepo.save(makeSession('sess-done', 'done'))
    useSessionStore.setState({ activeId: 'sess-done' })

    render(<SystemView />)

    // The guard clears the stale pointer, so the idle CTA renders instead.
    expect(await screen.findByRole('button', { name: /Start a brew/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Return to runner/i })).not.toBeInTheDocument()
    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
    expect(persistedActiveId()).toBeNull() // dead id no longer lingers in localStorage
  })

  it('a stale ABORTED pointer is cleared on mount', async () => {
    await sessionRepo.save(makeSession('sess-aborted', 'aborted'))
    useSessionStore.setState({ activeId: 'sess-aborted' })

    render(<SystemView />)

    expect(await screen.findByRole('button', { name: /Start a brew/i })).toBeInTheDocument()
    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
    expect(persistedActiveId()).toBeNull()
  })
})
