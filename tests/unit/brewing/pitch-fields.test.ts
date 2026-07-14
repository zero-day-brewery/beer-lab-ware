import { describe, expect, it } from 'vitest'
import { BatchSchema } from '@/lib/brewing/types/batch'
import { BrewSessionSchema } from '@/lib/brewing/types/session'
import { YeastLotSchema } from '@/lib/brewing/types/yeast-lot'

const ISO = '2026-07-13T00:00:00.000Z'
const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('additive yeast/pitch fields', () => {
  it('YeastLot.parentLotId: key omitted when absent', () => {
    const base = {
      id: UUID,
      name: 'WLP001',
      strain: 'California Ale',
      form: 'slurry',
      productionDate: ISO,
      initialCells_B: 100,
      generation: 1,
      quantity: 200,
      unit: 'mL',
      notes_md: '',
      createdAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    } as const
    const withLineage = YeastLotSchema.parse({
      ...base,
      parentLotId: UUID,
    })
    expect(withLineage.parentLotId).toBe(UUID)
    const without = YeastLotSchema.parse(base)
    expect('parentLotId' in without).toBe(false)
  })

  it('YeastLot.harvestedFromBatchId: key omitted when absent', () => {
    const base = {
      id: UUID,
      name: 'WLP001',
      strain: 'California Ale',
      form: 'slurry',
      productionDate: ISO,
      initialCells_B: 100,
      generation: 1,
      quantity: 200,
      unit: 'mL',
      notes_md: '',
      createdAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    } as const
    const withHarvest = YeastLotSchema.parse({
      ...base,
      harvestedFromBatchId: UUID,
    })
    expect(withHarvest.harvestedFromBatchId).toBe(UUID)
    const without = YeastLotSchema.parse(base)
    expect('harvestedFromBatchId' in without).toBe(false)
  })

  it('BrewSessionSchema.yeastLotId: key omitted when absent', () => {
    const base = {
      id: UUID,
      manualVersion: 1,
      lifecycle: 'idle' as const,
      stageId: 'prep' as const,
      cursor: 'step-1',
      resolvedSteps: [],
      steps: {},
      choices: {},
      timers: [],
      startedAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    } as const
    const withYeast = BrewSessionSchema.parse({
      ...base,
      yeastLotId: UUID,
    })
    expect(withYeast.yeastLotId).toBe(UUID)
    const without = BrewSessionSchema.parse(base)
    expect('yeastLotId' in without).toBe(false)
  })

  it('BatchSchema.yeastLotId: key omitted when absent', () => {
    const base = {
      id: UUID,
      batchNo: 1,
      name: 'Test Batch',
      status: 'in-progress' as const,
      process: [],
      logs: [],
      timers: [],
      results: {},
      startedAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    } as const
    const withYeast = BatchSchema.parse({
      ...base,
      yeastLotId: UUID,
    })
    expect(withYeast.yeastLotId).toBe(UUID)
    const without = BatchSchema.parse(base)
    expect('yeastLotId' in without).toBe(false)
  })

  it('BatchSchema.yeastDeducted: key omitted when absent', () => {
    const base = {
      id: UUID,
      batchNo: 1,
      name: 'Test Batch',
      status: 'in-progress' as const,
      process: [],
      logs: [],
      timers: [],
      results: {},
      startedAt: ISO,
      updatedAt: ISO,
      schemaVersion: 1,
    } as const
    const withDeducted = BatchSchema.parse({
      ...base,
      yeastDeducted: true,
    })
    expect(withDeducted.yeastDeducted).toBe(true)
    const without = BatchSchema.parse(base)
    expect('yeastDeducted' in without).toBe(false)
  })

  it('schema definitions: yeastLotId + yeastDeducted fields exist', () => {
    expect(BrewSessionSchema.shape.yeastLotId).toBeDefined()
    expect(BatchSchema.shape.yeastLotId).toBeDefined()
    expect(BatchSchema.shape.yeastDeducted).toBeDefined()
  })
})
