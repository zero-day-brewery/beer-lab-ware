// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrewSession } from '@/lib/brewing/process/session'
import { sessionRepo } from '@/lib/db/repos/session'
import { useSessionStore } from '@/stores/session-store'

const STEP = 'prep-read-batch-numbers'

function makeRunning(id = 'store-sess'): BrewSession {
  return {
    id,
    recipeName: 'Test Brew',
    manualVersion: 1,
    lifecycle: 'running',
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

describe('session-store lifecycle actions', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, activeId: null, lastRejection: null })
    localStorage.clear()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pause() → paused, resume() → running', async () => {
    await useSessionStore.getState().setActive(makeRunning())
    useSessionStore.getState().pause()
    expect(useSessionStore.getState().session?.lifecycle).toBe('paused')
    useSessionStore.getState().resume()
    expect(useSessionStore.getState().session?.lifecycle).toBe('running')
  })

  it('complete() → done', async () => {
    await useSessionStore.getState().setActive(makeRunning())
    useSessionStore.getState().complete()
    expect(useSessionStore.getState().session?.lifecycle).toBe('done')
  })

  it('complete() milestone-flushes immediately (persists done body)', async () => {
    await useSessionStore.getState().setActive(makeRunning('flush-sess'))
    const saveSpy = vi.spyOn(sessionRepo, 'save')
    useSessionStore.getState().complete()
    // Milestone actions flush synchronously (immediate doSave), no debounce wait.
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy.mock.calls[0][0].lifecycle).toBe('done')
  })

  it('clear() nulls session + activeId and persists activeId null', async () => {
    await useSessionStore.getState().setActive(makeRunning('clear-sess'))
    expect(useSessionStore.getState().activeId).toBe('clear-sess')
    useSessionStore.getState().clear()
    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
    const raw = JSON.parse(localStorage.getItem('brew-session') ?? '{}')
    expect(raw.state.activeId).toBeNull()
  })

  it('clear() cancels a pending debounced (non-milestone) save', async () => {
    await useSessionStore.getState().setActive(makeRunning('timer-sess'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const saveSpy = vi.spyOn(sessionRepo, 'save')
    // goto is NOT a milestone → schedules a 1.5s debounced save.
    useSessionStore.getState().dispatch({ t: 'goto', step: STEP, now: new Date().toISOString() })
    useSessionStore.getState().clear()
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveSpy).not.toHaveBeenCalled()
  })
})
