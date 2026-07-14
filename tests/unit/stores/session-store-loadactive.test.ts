// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrewSession } from '@/lib/brewing/process/session'
import { sessionRepo } from '@/lib/db/repos/session'
import { db } from '@/lib/db/schema'
import { useSessionStore } from '@/stores/session-store'

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

describe('session-store loadActive — lifecycle gating (Fix 3)', () => {
  beforeEach(async () => {
    useSessionStore.setState({ session: null, activeId: null, lastRejection: null })
    localStorage.clear()
    await db.brewSessions.clear()
  })
  afterEach(async () => {
    await db.brewSessions.clear()
  })

  it('a persisted ABORTED id clears both session and the pointer (persists null)', async () => {
    await sessionRepo.save(makeSession('sess-aborted', 'aborted'))
    useSessionStore.setState({ activeId: 'sess-aborted' })

    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
    expect(persistedActiveId()).toBeNull() // dead id no longer lingers in localStorage
  })

  it('a persisted DONE id clears both session and the pointer', async () => {
    await sessionRepo.save(makeSession('sess-done', 'done'))
    useSessionStore.setState({ activeId: 'sess-done' })

    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
    expect(persistedActiveId()).toBeNull()
  })

  it('a persisted ARCHIVED id is not adopted', async () => {
    await sessionRepo.save(makeSession('sess-archived', 'archived'))
    useSessionStore.setState({ activeId: 'sess-archived' })

    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
  })

  it('a persisted RUNNING id is adopted (genuine resume not regressed)', async () => {
    await sessionRepo.save(makeSession('sess-running', 'running'))
    useSessionStore.setState({ activeId: 'sess-running' })

    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session?.id).toBe('sess-running')
    expect(useSessionStore.getState().session?.lifecycle).toBe('running')
    expect(useSessionStore.getState().activeId).toBe('sess-running')
  })

  it('a persisted PAUSED id is adopted', async () => {
    await sessionRepo.save(makeSession('sess-paused', 'paused'))
    useSessionStore.setState({ activeId: 'sess-paused' })

    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session?.id).toBe('sess-paused')
    expect(useSessionStore.getState().session?.lifecycle).toBe('paused')
    expect(useSessionStore.getState().activeId).toBe('sess-paused')
  })

  it('no persisted id → getActive() fallback adopts a running session in Dexie', async () => {
    await sessionRepo.save(makeSession('sess-fallback', 'running'))
    // activeId already null from beforeEach.
    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session?.id).toBe('sess-fallback')
    expect(useSessionStore.getState().activeId).toBe('sess-fallback')
  })

  it('no persisted id + only a done session in Dexie → stays null (getActive filters it)', async () => {
    await sessionRepo.save(makeSession('sess-done-only', 'done'))
    await useSessionStore.getState().loadActive()

    expect(useSessionStore.getState().session).toBeNull()
    expect(useSessionStore.getState().activeId).toBeNull()
  })
})
