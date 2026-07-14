import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import { makeTimerRepo } from '@/lib/db/repos/timer'
import { BrewDB } from '@/lib/db/schema'

const SESSION = '550e8400-e29b-41d4-a716-446655440301'

const armed: BrewTimer = {
  id: '550e8400-e29b-41d4-a716-446655440300',
  sessionId: SESSION,
  stepId: 'ramp-to-boil',
  label: 'Boil',
  durationMin: 60,
  fireAt: '2026-06-25T13:00:00.000Z',
  status: 'armed',
  isBoilMaster: true,
}

describe('timerRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeTimerRepo>

  beforeEach(async () => {
    db = new BrewDB('test-timers')
    await db.open()
    repo = makeTimerRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-timers')
  })

  it('save() then get() round-trips through Zod', async () => {
    await repo.save(armed)
    const fetched = await repo.get(armed.id)
    expect(fetched).toEqual(armed)
  })

  it('saveMany() persists a batch of timers', async () => {
    const child: BrewTimer = {
      ...armed,
      id: '550e8400-e29b-41d4-a716-446655440399',
      isBoilMaster: false,
      parentId: armed.id,
      label: 'Magnum (60 min)',
    }
    await repo.saveMany([armed, child])
    expect(await repo.bySession(SESSION)).toHaveLength(2)
  })

  it('armed() returns only armed timers (filter, not boolean where)', async () => {
    await repo.save(armed)
    await repo.save({
      ...armed,
      id: '550e8400-e29b-41d4-a716-446655440398',
      status: 'fired',
      firedAt: '2026-06-25T13:00:05.000Z',
    })
    const open = await repo.armed()
    expect(open).toHaveLength(1)
    expect(open[0].status).toBe('armed')
  })

  it('deleteBySession() clears a session worth of timers', async () => {
    await repo.save(armed)
    await repo.deleteBySession(SESSION)
    expect(await repo.bySession(SESSION)).toEqual([])
  })

  it('save() rejects an invalid row before it hits Dexie', async () => {
    // @ts-expect-error — deliberately invalid status
    await expect(repo.save({ ...armed, status: 'paused' })).rejects.toThrow()
  })
})
