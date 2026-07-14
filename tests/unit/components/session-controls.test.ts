import { describe, expect, it, vi } from 'vitest'
import { abortBrew, completeBrew } from '@/components/system/run/session-controls'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { Batch } from '@/lib/brewing/types/batch'

const NOW = '2026-07-05T12:00:00.000Z'

function makeSession(): BrewSession {
  return {
    id: 'sess-ctrl',
    recipeName: 'Control Brew',
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'x',
    resolvedSteps: ['x'],
    steps: { x: { id: 'x', status: 'active', logs: [] } },
    choices: {},
    timers: [],
    startedAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
  }
}

function makeBatch(): Batch {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    batchNo: 4,
    name: 'Control Brew',
    status: 'in-progress',
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
  }
}

function stubDeps() {
  return {
    complete: vi.fn(),
    abort: vi.fn(),
    flushSession: vi.fn(async () => {}),
    clearSession: vi.fn(),
    clearBatch: vi.fn(),
    save: vi.fn(async (b: Batch) => b),
  }
}

describe('completeBrew', () => {
  it('declined confirm → no side effects', async () => {
    const d = stubDeps()
    const res = await completeBrew({
      session: makeSession(),
      activeBatch: makeBatch(),
      fermenterId: 'f1',
      now: NOW,
      batchRepo: { save: d.save },
      complete: d.complete,
      flushSession: d.flushSession,
      clearSession: d.clearSession,
      clearBatch: d.clearBatch,
      confirm: () => false,
    })
    expect(res.completed).toBe(false)
    expect(d.complete).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
    expect(d.clearSession).not.toHaveBeenCalled()
    expect(d.clearBatch).not.toHaveBeenCalled()
  })

  it('confirmed → completes session, saves batch as complete, clears both, returns batchId', async () => {
    const d = stubDeps()
    const batch = makeBatch()
    const res = await completeBrew({
      session: makeSession(),
      activeBatch: batch,
      fermenterId: 'f1',
      now: NOW,
      batchRepo: { save: d.save },
      complete: d.complete,
      flushSession: d.flushSession,
      clearSession: d.clearSession,
      clearBatch: d.clearBatch,
      confirm: () => true,
    })
    expect(res).toEqual({ completed: true, batchId: batch.id })
    expect(d.complete).toHaveBeenCalledTimes(1)
    expect(d.flushSession).toHaveBeenCalledTimes(1)
    expect(d.save).toHaveBeenCalledTimes(1)
    expect(d.save.mock.calls[0][0].status).toBe('complete')
    expect(d.save.mock.calls[0][0].id).toBe(batch.id)
    expect(d.save.mock.calls[0][0].batchNo).toBe(batch.batchNo)
    expect(d.clearSession).toHaveBeenCalledTimes(1)
    expect(d.clearBatch).toHaveBeenCalledTimes(1)
  })

  it('confirmed with no active batch → still completes + clears, no save, batchId null', async () => {
    const d = stubDeps()
    const res = await completeBrew({
      session: makeSession(),
      activeBatch: null,
      fermenterId: 'f1',
      now: NOW,
      batchRepo: { save: d.save },
      complete: d.complete,
      flushSession: d.flushSession,
      clearSession: d.clearSession,
      clearBatch: d.clearBatch,
      confirm: () => true,
    })
    expect(res).toEqual({ completed: true, batchId: null })
    expect(d.save).not.toHaveBeenCalled()
    expect(d.complete).toHaveBeenCalledTimes(1)
    expect(d.clearSession).toHaveBeenCalledTimes(1)
  })
})

describe('abortBrew', () => {
  it('declined confirm → no side effects', async () => {
    const d = stubDeps()
    const res = await abortBrew({
      activeBatch: makeBatch(),
      now: NOW,
      batchRepo: { save: d.save },
      abort: d.abort,
      flushSession: d.flushSession,
      clearSession: d.clearSession,
      clearBatch: d.clearBatch,
      confirm: () => false,
    })
    expect(res.aborted).toBe(false)
    expect(d.save).not.toHaveBeenCalled()
    expect(d.abort).not.toHaveBeenCalled()
    expect(d.clearSession).not.toHaveBeenCalled()
  })

  it('confirmed → ARCHIVES the batch (status archived + archivedAt), aborts session, clears both', async () => {
    const d = stubDeps()
    const res = await abortBrew({
      activeBatch: makeBatch(),
      now: NOW,
      batchRepo: { save: d.save },
      abort: d.abort,
      flushSession: d.flushSession,
      clearSession: d.clearSession,
      clearBatch: d.clearBatch,
      confirm: () => true,
    })
    expect(res.aborted).toBe(true)
    expect(d.save).toHaveBeenCalledTimes(1)
    const saved = d.save.mock.calls[0][0]
    expect(saved.status).toBe('archived') // never left in-progress
    expect(saved.archivedAt).toBe(NOW)
    expect(d.abort).toHaveBeenCalledTimes(1)
    expect(d.clearSession).toHaveBeenCalledTimes(1)
    expect(d.clearBatch).toHaveBeenCalledTimes(1)
  })

  it('confirmed with no active batch → skips save but still aborts + clears', async () => {
    const d = stubDeps()
    const res = await abortBrew({
      activeBatch: null,
      now: NOW,
      batchRepo: { save: d.save },
      abort: d.abort,
      flushSession: d.flushSession,
      clearSession: d.clearSession,
      clearBatch: d.clearBatch,
      confirm: () => true,
    })
    expect(res.aborted).toBe(true)
    expect(d.save).not.toHaveBeenCalled()
    expect(d.abort).toHaveBeenCalledTimes(1)
    expect(d.clearSession).toHaveBeenCalledTimes(1)
    expect(d.clearBatch).toHaveBeenCalledTimes(1)
  })
})
