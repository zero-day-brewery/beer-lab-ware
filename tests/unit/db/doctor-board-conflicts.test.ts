import { afterEach, describe, expect, it } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'
import { autoFixBoardConflicts, runDataDoctor } from '@/lib/db/doctor'
import { BrewDB } from '@/lib/db/schema'

const dbs: BrewDB[] = []
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})
function freshDb(): BrewDB {
  const d = new BrewDB(`doctor-c10-${Date.now()}-${dbs.length}`)
  dbs.push(d)
  return d
}

const ip = (id: string, batchNo: number, board = 'f1') =>
  ({
    id,
    batchNo,
    status: 'in-progress',
    fermenterBoardId: board,
    logs: [],
    updatedAt: '2026-07-01T00:00:00.000Z',
  }) as unknown as Batch

describe('doctor C10 — one in-progress batch per fermenter', () => {
  it('flags two in-progress batches on one vessel as an autofixable error, then autofix clears it', async () => {
    const db = freshDb()
    await db.open()
    await db.batches.bulkPut([ip('aaaa', 1), ip('bbbb', 2)])

    let report = await runDataDoctor(db)
    const c10 = report.checks.find((c) => c.id === 'C10')
    expect(c10?.ok).toBe(false)
    expect(c10?.severity).toBe('error')
    expect(c10?.canAutoFix).toBe(true)
    expect(c10?.count).toBe(1) // one loser to archive

    const fixed = await autoFixBoardConflicts(db)
    expect(fixed).toBe(1)

    // Re-run: clean. Nothing deleted — the loser is archived, still present.
    report = await runDataDoctor(db)
    expect(report.checks.find((c) => c.id === 'C10')?.ok).toBe(true)
    const rows = await db.batches.toArray()
    expect(rows).toHaveLength(2)
    expect(rows.filter((b) => b.status === 'in-progress')).toHaveLength(1)
    expect(rows.filter((b) => b.status === 'archived')).toHaveLength(1)
  })

  it('passes cleanly when every vessel has at most one in-progress batch', async () => {
    const db = freshDb()
    await db.open()
    await db.batches.bulkPut([ip('a', 1, 'f1'), ip('b', 2, 'f2')])
    const report = await runDataDoctor(db)
    expect(report.checks.find((c) => c.id === 'C10')?.ok).toBe(true)
    expect(await autoFixBoardConflicts(db)).toBe(0)
  })
})
