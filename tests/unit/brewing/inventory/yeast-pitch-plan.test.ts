import { describe, expect, it } from 'vitest'

import { planYeastPitch } from '@/lib/brewing/inventory/yeast-pitch-plan'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const NOW = new Date('2026-06-01T00:00:00.000Z')

function lot(over: Partial<YeastLot> & { daysAgo: number }): YeastLot {
  const { daysAgo, ...rest } = over
  return {
    id: crypto.randomUUID(),
    name: 'WLP001 California Ale',
    strain: 'California Ale',
    form: 'liquid',
    initialCells_B: 100,
    generation: 0,
    quantity: 1,
    unit: 'vial',
    notes_md: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
    productionDate: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    ...rest,
  }
}

describe('planYeastPitch', () => {
  it('computes required cells from the batch then selects a FIFO-viable lot', () => {
    const plan = planYeastPitch({
      og: 1.05,
      batchSize_L: 20,
      style: 'ale',
      strain: 'California Ale',
      lots: [lot({ daysAgo: 5, initialCells_B: 300 })],
      now: NOW,
    })
    expect(plan.pitch.cells_B).toBeGreaterThan(0)
    expect(plan.selection.chosen).not.toBeNull()
    // required cells fed into the selection == the computed pitch requirement
    expect(plan.selection.requiredCells_B).toBeCloseTo(plan.pitch.cells_B, 5)
  })

  it('recommends a starter when a big lager pitch outstrips a single aging vial', () => {
    const plan = planYeastPitch({
      og: 1.07,
      batchSize_L: 20,
      style: 'lager', // high rate → large requirement
      strain: 'California Ale',
      lots: [lot({ daysAgo: 40, initialCells_B: 100 })],
      now: NOW,
    })
    expect(plan.selection.starterRecommended).toBe(true)
  })
})
