import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrewSession } from '@/lib/brewing/process/session'
import { makeSessionRepo } from '@/lib/db/repos/session'
import { BrewDB } from '@/lib/db/schema'

function mk(overrides: Partial<BrewSession> = {}): BrewSession {
  return {
    id: '550e8400-e29b-41d4-a716-446655440300',
    recipeId: '550e8400-e29b-41d4-a716-446655440099',
    recipeName: 'SMaSH Pale Ale',
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'p1',
    resolvedSteps: ['p1', 'p2'],
    steps: {
      p1: { id: 'p1', status: 'active', logs: [] },
      p2: { id: 'p2', status: 'pending', logs: [] },
    },
    choices: {},
    timers: [],
    startedAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  }
}

describe('sessionRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeSessionRepo>

  beforeEach(async () => {
    db = new BrewDB('test-sessions')
    await db.open()
    repo = makeSessionRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-sessions')
  })

  it('save then get returns a deep-equal session', async () => {
    const s = mk()
    await repo.save(s)
    const got = await repo.get(s.id)
    expect(got).toEqual({ ...s, updatedAt: got?.updatedAt })
    expect(got?.cursor).toBe('p1')
  })

  it('save stamps updatedAt forward', async () => {
    const s = mk({ updatedAt: '2020-01-01T00:00:00.000Z' })
    const saved = await repo.save(s)
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(
      new Date('2020-01-01T00:00:00.000Z').getTime(),
    )
  })

  it('getActive returns the running session and ignores done/aborted', async () => {
    await repo.save(mk({ id: '550e8400-e29b-41d4-a716-446655440301', lifecycle: 'done' }))
    await repo.save(mk({ id: '550e8400-e29b-41d4-a716-446655440302', lifecycle: 'aborted' }))
    await repo.save(mk({ id: '550e8400-e29b-41d4-a716-446655440303', lifecycle: 'paused' }))
    const active = await repo.getActive()
    expect(active?.id).toBe('550e8400-e29b-41d4-a716-446655440303')
  })

  it('getActive returns null when no running/paused session exists', async () => {
    await repo.save(mk({ lifecycle: 'done' }))
    expect(await repo.getActive()).toBeNull()
  })

  it('delete removes the session', async () => {
    const s = mk()
    await repo.save(s)
    await repo.delete(s.id)
    expect(await repo.get(s.id)).toBeNull()
  })

  it('save rejects an invalid session (Zod guard at the write boundary)', async () => {
    const bad = { ...mk(), lifecycle: 'bogus' } as unknown as BrewSession
    await expect(repo.save(bad)).rejects.toThrow()
  })
})
