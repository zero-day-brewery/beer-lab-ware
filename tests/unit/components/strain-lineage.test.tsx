// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StrainLineage } from '@/components/yeast/strain-lineage'
import { buildLineage } from '@/lib/brewing/inventory/yeast-lineage'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const ISO = '2026-07-13T00:00:00.000Z'
const lot = (p: Partial<YeastLot> & { id: string }): YeastLot => ({
  name: 'WLP001',
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

describe('StrainLineage (Layout A)', () => {
  it('renders a node per generation with the strain heading', () => {
    const [line] = buildLineage([
      lot({ id: 'a', generation: 0 }),
      lot({ id: 'b', generation: 1, parentLotId: 'a' }),
    ])
    render(<StrainLineage lineage={line} />)
    expect(screen.getByText(/California Ale/i)).toBeInTheDocument()
    expect(screen.getAllByTestId('lineage-node')).toHaveLength(2)
  })
  it('dims a spent (quantity 0) lot', () => {
    const [line] = buildLineage([lot({ id: 'a', quantity: 0 })])
    render(<StrainLineage lineage={line} />)
    expect(screen.getByTestId('lineage-node').className).toMatch(/spent|opacity/)
  })
  it('renders the batch link with a real sequential batchNo, not a uuid fragment', () => {
    const batchId = '11111111-1111-4111-8111-111111111111'
    const [line] = buildLineage([lot({ id: 'a', harvestedFromBatchId: batchId })])
    const batchNoById = new Map([[batchId, 12]])
    render(<StrainLineage lineage={line} batchNoById={batchNoById} />)
    const link = screen.getByRole('link', { name: '◈ #12' })
    expect(link).toHaveAttribute('href', `/logbook/view?id=${batchId}`)
  })
  it('falls back to a dash placeholder when the batchNo is unknown', () => {
    const batchId = '22222222-2222-4222-8222-222222222222'
    const [line] = buildLineage([lot({ id: 'a', harvestedFromBatchId: batchId })])
    render(<StrainLineage lineage={line} />)
    expect(screen.getByRole('link', { name: '◈ #—' })).toBeInTheDocument()
  })

  it('renders an orphaned root (missing parent) inline in the tree with a "parent missing" badge — subtree intact, not flattened into the flat orphan strip', () => {
    const [line] = buildLineage([
      lot({ id: 'b', name: 'Orphaned Root', generation: 1, parentLotId: 'ghost' }),
      lot({ id: 'c', name: 'Child Lot', generation: 2, parentLotId: 'b' }),
    ])
    render(<StrainLineage lineage={line} />)

    // Both nodes render in the tree (subtree survived the missing parent)
    expect(screen.getAllByTestId('lineage-node')).toHaveLength(2)
    expect(screen.getByText('Orphaned Root')).toBeInTheDocument()
    expect(screen.getByText('Child Lot')).toBeInTheDocument()

    // The flat "parent missing" strip is for the rare pure-cycle case only —
    // orphanLots is empty here, so it must not render.
    expect(document.querySelector('.lineage-orphans')).not.toBeInTheDocument()

    const rootCard = screen.getByText('Orphaned Root').closest('[data-testid="lineage-node"]')
    expect(rootCard).not.toBeNull()
    expect(within(rootCard as HTMLElement).getByText(/parent missing/i)).toBeInTheDocument()

    const childCard = screen.getByText('Child Lot').closest('[data-testid="lineage-node"]')
    expect(childCard).not.toBeNull()
    expect(within(childCard as HTMLElement).queryByText(/parent missing/i)).not.toBeInTheDocument()
  })

  it('sets --fc to the destructive token on a below-viability-floor lot, and to malt otherwise', () => {
    const [belowLine] = buildLineage([
      lot({ id: 'a', form: 'slurry', productionDate: '2020-01-01T00:00:00.000Z' }),
    ])
    render(<StrainLineage lineage={belowLine} />)
    const belowCard = screen.getByTestId('lineage-node') as HTMLElement
    expect(belowCard.style.getPropertyValue('--fc')).toBe('var(--destructive)')
  })

  it('sets --fc to malt/primary for a lot at/above the viability floor', () => {
    const [okLine] = buildLineage([lot({ id: 'a' })])
    render(<StrainLineage lineage={okLine} />)
    const okCard = screen.getByTestId('lineage-node') as HTMLElement
    expect(okCard.style.getPropertyValue('--fc')).toBe('var(--malt, var(--primary))')
  })
})
