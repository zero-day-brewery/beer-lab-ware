import { describe, expect, it } from 'vitest'
import { GENERATION_WARN_AT, planHarvest } from '@/lib/brewing/inventory/yeast-harvest'
import { type YeastLot, YeastLotSchema } from '@/lib/brewing/types/yeast-lot'

const ISO = (d: string) => `${d}T00:00:00.000Z`
const PARENT_ID = '550e8400-e29b-41d4-a716-446655440001'
const BATCH_ID = '550e8400-e29b-41d4-a716-446655440002'

function parent(p: Partial<YeastLot> = {}): YeastLot {
  return {
    id: PARENT_ID,
    name: 'WLP001 California Ale',
    strain: 'California Ale',
    form: 'slurry',
    productionDate: ISO('2026-07-01'),
    initialCells_B: 300,
    generation: 1,
    quantity: 250,
    unit: 'mL',
    notes_md: '',
    createdAt: ISO('2026-07-01'),
    updatedAt: ISO('2026-07-01'),
    schemaVersion: 1,
    ...p,
  }
}
const NOW = new Date(ISO('2026-07-10'))

describe('planHarvest', () => {
  it('creates a gen+1 slurry child linked to parent + batch, cells estimated from volume×viability', () => {
    const plan = planHarvest({
      parentLot: parent(),
      slurryVolume_mL: 200,
      harvestDate: ISO('2026-07-10'),
      batchId: BATCH_ID,
      now: NOW,
    })
    expect(plan.draft.generation).toBe(2)
    expect(plan.draft.parentLotId).toBe(PARENT_ID)
    expect(plan.draft.harvestedFromBatchId).toBe(BATCH_ID)
    expect(plan.draft.form).toBe('slurry')
    expect(plan.estimatedCells_B).toBeGreaterThan(0)
    expect(plan.canSave).toBe(true)
    // stamped draft is a valid YeastLot
    expect(() =>
      YeastLotSchema.parse({
        ...plan.draft,
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: ISO('2026-07-10'),
        updatedAt: ISO('2026-07-10'),
      }),
    ).not.toThrow()
  })

  it('zero-cell (dead parent) → canSave false, initialCells_B floored positive (no save crash)', () => {
    const dead = parent({ productionDate: ISO('2020-01-01') }) // viability clamps to 0
    const plan = planHarvest({
      parentLot: dead,
      slurryVolume_mL: 200,
      harvestDate: ISO('2026-07-10'),
      now: NOW,
    })
    expect(plan.estimatedCells_B).toBe(0)
    expect(plan.canSave).toBe(false)
    expect(plan.draft.initialCells_B).toBeGreaterThan(0) // floored — never violates .positive()
    // stamped draft is a valid YeastLot
    expect(() =>
      YeastLotSchema.parse({
        ...plan.draft,
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: ISO('2026-07-10'),
        updatedAt: ISO('2026-07-10'),
      }),
    ).not.toThrow()
  })

  it('zero volume → canSave false', () => {
    const plan = planHarvest({
      parentLot: parent(),
      slurryVolume_mL: 0,
      harvestDate: ISO('2026-07-10'),
      now: NOW,
    })
    expect(plan.canSave).toBe(false)
    // stamped draft is a valid YeastLot
    expect(() =>
      YeastLotSchema.parse({
        ...plan.draft,
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: ISO('2026-07-10'),
        updatedAt: ISO('2026-07-10'),
      }),
    ).not.toThrow()
  })

  it('warns on generation drift at the threshold', () => {
    const plan = planHarvest({
      parentLot: parent({ generation: GENERATION_WARN_AT - 1 }),
      slurryVolume_mL: 200,
      harvestDate: ISO('2026-07-10'),
      now: NOW,
    })
    expect(plan.warnings.some((w) => /generation|drift/i.test(w))).toBe(true)
  })
})
