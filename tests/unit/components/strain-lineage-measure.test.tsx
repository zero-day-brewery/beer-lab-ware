// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
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

describe('StrainLineage — measure cells', () => {
  it('records a direct cell measurement (value + date) and persists both fields', async () => {
    const [line] = buildLineage([lot({ id: 'a', name: 'Slurry A' })])
    render(<StrainLineage lineage={line} />)

    fireEvent.click(screen.getByRole('button', { name: 'Measure cells' }))
    fireEvent.change(screen.getByLabelText('Measured viable cells (billions) for Slurry A'), {
      target: { value: '210' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save measurement' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const saved = saveMock.mock.calls[0][0] as YeastLot
    expect(saved.measuredViableCells_B).toBe(210)
    expect(typeof saved.measuredAt).toBe('string')
    expect(() => new Date(saved.measuredAt as string).toISOString()).not.toThrow()
  })

  it('badges a measured lot and clears back to the estimate', async () => {
    const [line] = buildLineage([
      lot({ id: 'a', name: 'Slurry A', measuredViableCells_B: 200, measuredAt: ISO }),
    ])
    render(<StrainLineage lineage={line} />)

    expect(screen.getByTestId('measured-badge')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear measurement' }))
    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const saved = saveMock.mock.calls[0][0] as YeastLot
    expect(saved.measuredViableCells_B).toBeUndefined()
    expect(saved.measuredAt).toBeUndefined()
  })

  it('rejects a non-positive measurement without saving', async () => {
    const [line] = buildLineage([lot({ id: 'a', name: 'Slurry A' })])
    render(<StrainLineage lineage={line} />)

    fireEvent.click(screen.getByRole('button', { name: 'Measure cells' }))
    fireEvent.change(screen.getByLabelText('Measured viable cells (billions) for Slurry A'), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save measurement' }))

    await waitFor(() => expect(vi.mocked(toast).error).toHaveBeenCalled())
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('an un-measured lot shows no measured badge', () => {
    const [line] = buildLineage([lot({ id: 'a', name: 'Slurry A' })])
    render(<StrainLineage lineage={line} />)
    expect(screen.queryByTestId('measured-badge')).not.toBeInTheDocument()
  })
})
