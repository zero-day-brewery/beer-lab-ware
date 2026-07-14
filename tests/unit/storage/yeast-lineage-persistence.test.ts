// tests/unit/storage/yeast-lineage-persistence.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { Batch } from '@/lib/brewing/types/batch'
import { backupService } from '@/lib/db/backup' // real entry points: backupService.dump() / .restore()
import { db } from '@/lib/db/schema'

const ISO = '2026-07-13T00:00:00.000Z'
const U = (n: number) => `550e8400-e29b-41d4-a716-4466554400${n.toString().padStart(2, '0')}`

describe('yeast lineage + pitch fields survive a dump→restore round-trip', () => {
  beforeEach(async () => {
    await db.yeastLots.clear()
    await db.batches.clear()
    await db.brewSessions.clear()
  })

  it('preserves parentLotId, harvestedFromBatchId, Batch.yeastLotId, BrewSession.yeastLotId', async () => {
    await db.yeastLots.put({
      id: U(1),
      name: 'WLP001',
      strain: 'California Ale',
      form: 'slurry',
      productionDate: ISO,
      initialCells_B: 300,
      generation: 1,
      quantity: 200,
      unit: 'mL',
      parentLotId: U(2),
      harvestedFromBatchId: U(3),
      notes_md: '',
      createdAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    })
    // Minimal valid batch + session rows carrying yeastLotId (every required field
    // per BatchSchema / BrewSessionSchema — optional fields omitted).
    const batch: Batch = {
      id: U(4),
      batchNo: 1,
      name: 'Lineage Test Batch',
      status: 'in-progress',
      yeastLotId: U(1),
      process: [],
      logs: [],
      timers: [],
      results: {},
      startedAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    }
    await db.batches.put(batch)
    const session: BrewSession = {
      id: U(5),
      yeastLotId: U(1),
      manualVersion: 1,
      lifecycle: 'running',
      stageId: 'fermentation',
      cursor: 'ferm-start',
      resolvedSteps: [],
      steps: {},
      choices: {},
      timers: [],
      startedAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    }
    await db.brewSessions.put(session)

    const dump = await backupService.dump()
    await db.yeastLots.clear()
    await db.batches.clear()
    await db.brewSessions.clear()
    await backupService.restore(dump) // restore(d: Dump): Promise<void> — clears then bulkPuts in one rw tx

    const lot = await db.yeastLots.get(U(1))
    expect(lot?.parentLotId).toBe(U(2))
    expect(lot?.harvestedFromBatchId).toBe(U(3))
    expect((await db.batches.get(U(4)))?.yeastLotId).toBe(U(1))
    expect((await db.brewSessions.get(U(5)))?.yeastLotId).toBe(U(1))
  })
})
