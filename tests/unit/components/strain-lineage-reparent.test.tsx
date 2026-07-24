// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLineage } from '@/lib/brewing/inventory/yeast-lineage'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const saveMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/db/repos/yeast-lots', () => ({
  yeastLotsRepo: { save: (l: unknown) => saveMock(l), remove: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/diagnostics/error-log', () => ({ reportDbError: vi.fn() }))
vi.mock('@/components/yeast/harvest-form', () => ({ HarvestForm: () => null }))

import { StrainLineage } from '@/components/yeast/strain-lineage'

const ISO = '2026-07-13T00:00:00.000Z'
const lot = (p: Partial<YeastLot> & { id: string }): YeastLot => ({
  name: p.id,
  strain: 'California Ale',
  form: 'slurry',
  productionDate: ISO,
  initialCells_B: 100,
  generation: 0,
  quantity: 1,
  unit: 'mL',
  notes_md: '',
  createdAt: ISO,
  updatedAt: ISO,
  schemaVersion: 1,
  ...p,
})

afterEach(() => vi.clearAllMocks())

describe('StrainLineage — re-parent orphan', () => {
  it('offers only valid candidates and reassigns parentLotId, preserving generation', async () => {
    const [line] = buildLineage([
      lot({ id: 'a', name: 'Gen0 Root' }), // valid candidate
      lot({ id: 'b', name: 'Orphan', generation: 3, parentLotId: 'ghost' }), // orphaned root
      lot({ id: 'c', name: 'Child', generation: 4, parentLotId: 'b' }), // b's descendant → must be excluded
    ])
    render(<StrainLineage lineage={line} />)

    const select = screen.getByLabelText('New parent for Orphan') as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toContain('a') // sibling root, valid
    expect(values).not.toContain('b') // self, excluded
    expect(values).not.toContain('c') // descendant, excluded (cycle)

    fireEvent.change(select, { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const saved = saveMock.mock.calls[0][0] as YeastLot
    expect(saved.id).toBe('b')
    expect(saved.parentLotId).toBe('a')
    expect(saved.generation).toBe(3) // PRESERVED — only the link changed
  })

  it('"— No parent (make root) —" clears parentLotId', async () => {
    const [line] = buildLineage([lot({ id: 'b', name: 'Orphan', parentLotId: 'ghost' })])
    render(<StrainLineage lineage={line} />)
    // default select value is '' (make root)
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    expect((saveMock.mock.calls[0][0] as YeastLot).parentLotId).toBeUndefined()
  })

  it('a genuine root (no missing parent) shows NO re-parent control', () => {
    const [line] = buildLineage([lot({ id: 'a', name: 'Real Root' })])
    render(<StrainLineage lineage={line} />)
    expect(screen.queryByLabelText('New parent for Real Root')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reparent-row')).not.toBeInTheDocument()
  })
})
