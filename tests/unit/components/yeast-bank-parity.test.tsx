// tests/unit/components/yeast-bank-parity.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YeastBankView } from '@/components/yeast/yeast-bank-view'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const NOW_ISO = '2026-07-13T00:00:00.000Z'
const U = (n: number) => `550e8400-e29b-41d4-a716-4466554400${n.toString().padStart(2, '0')}`

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

function lot(p: Partial<YeastLot> & { id: string }): YeastLot {
  return {
    name: 'Test Lot',
    strain: 'Test Ale',
    form: 'dry',
    productionDate: NOW_ISO,
    initialCells_B: 100,
    generation: 0,
    quantity: 1,
    unit: 'packet',
    notes_md: '',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    schemaVersion: 1,
    ...p,
  }
}

/** Find the `[data-testid="lineage-node"]` card that contains the given lot name. */
function nodeFor(name: string): HTMLElement {
  const el = screen.getByText(name).closest('[data-testid="lineage-node"]')
  if (!el) throw new Error(`no lineage-node ancestor for "${name}"`)
  return el as HTMLElement
}

// Ported from the retired inventory-tab yeast panel — these three behaviors
// must survive the move into the Yeast Bank (`yeast-bank-view.tsx` / `strain-lineage.tsx`).
describe('Yeast Bank parity behaviors', () => {
  beforeEach(async () => {
    await db.yeastLots.clear()
  })

  it('shows a "use next" badge on the oldest in-stock, above-floor lot per strain (via selectYeastLot)', async () => {
    await yeastLotsRepo.save(lot({ id: U(1), name: 'Newer Pack', productionDate: isoDaysAgo(1) }))
    await yeastLotsRepo.save(lot({ id: U(2), name: 'Older Pack', productionDate: isoDaysAgo(20) }))

    render(<YeastBankView />)
    await screen.findByText('Older Pack')

    expect(within(nodeFor('Older Pack')).getByText(/use next/i)).toBeInTheDocument()
    expect(within(nodeFor('Newer Pack')).queryByText(/use next/i)).not.toBeInTheDocument()
  })

  it('supports an inline qty-edit control on a node', async () => {
    await yeastLotsRepo.save(lot({ id: U(3), name: 'Qty Pack', quantity: 3 }))

    render(<YeastBankView />)
    await screen.findByText('Qty Pack')

    fireEvent.click(within(nodeFor('Qty Pack')).getByRole('button', { name: /edit qty/i }))
    fireEvent.change(screen.getByLabelText('Quantity for Qty Pack'), { target: { value: '7' } })
    fireEvent.click(within(nodeFor('Qty Pack')).getByRole('button', { name: /^save$/i }))

    await waitFor(async () => {
      const saved = await yeastLotsRepo.get(U(3))
      expect(saved?.quantity).toBe(7)
    })
  })

  it('shows a low-viability badge on a below-floor lot', async () => {
    await yeastLotsRepo.save(
      lot({ id: U(4), name: 'Stale Slurry', form: 'slurry', productionDate: isoDaysAgo(40) }),
    )

    render(<YeastBankView />)
    expect(await screen.findByText(/low viability/i)).toBeInTheDocument()
  })
})

// The retired inventory panel's `LotRow` had a per-lot Delete button
// (`yeastLotsRepo.remove`) that the bank dropped when the parity behaviors
// above were ported. Restored per design spec §8: deleting a parent lot must
// warn how many children will orphan (become roots) before it commits.
describe('Yeast Bank — delete a lot', () => {
  beforeEach(async () => {
    await db.yeastLots.clear()
  })

  it('warns about orphaned children and calls yeastLotsRepo.remove with the parent id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const removeSpy = vi.spyOn(yeastLotsRepo, 'remove')

    const parentId = U(5)
    const childId = U(6)
    await yeastLotsRepo.save(lot({ id: parentId, name: 'Parent Lot' }))
    await yeastLotsRepo.save(
      lot({ id: childId, name: 'Child Lot', generation: 1, parentLotId: parentId }),
    )

    render(<YeastBankView />)
    await screen.findByText('Parent Lot')

    fireEvent.click(within(nodeFor('Parent Lot')).getByRole('button', { name: /^delete$/i }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const message = confirmSpy.mock.calls[0][0] as string
    expect(message).toMatch(/1 child lot/i)
    expect(message).toMatch(/orphan/i)

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(parentId))

    confirmSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('uses a plain confirm (no orphan warning) for a lot with no children', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const removeSpy = vi.spyOn(yeastLotsRepo, 'remove')

    const soloId = U(7)
    await yeastLotsRepo.save(lot({ id: soloId, name: 'Solo Lot' }))

    render(<YeastBankView />)
    await screen.findByText('Solo Lot')

    fireEvent.click(within(nodeFor('Solo Lot')).getByRole('button', { name: /^delete$/i }))

    const message = confirmSpy.mock.calls[0][0] as string
    expect(message).not.toMatch(/orphan/i)
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(soloId))

    confirmSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('warns about orphaned children when deleting an ORPHANED-ROOT lot (its own parent already missing) — subtree/child-count logic survives the mid-chain-delete fix', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const removeSpy = vi.spyOn(yeastLotsRepo, 'remove')

    // 'b' has a parentLotId pointing at nothing in the strain — an orphaned
    // root, rendered inline in the tree (not the flat strip) — with an
    // in-set child 'c' hanging off it.
    const rootId = U(9)
    const childId = U(10)
    await yeastLotsRepo.save(
      lot({ id: rootId, name: 'Orphaned Root Lot', generation: 1, parentLotId: U(99) }),
    )
    await yeastLotsRepo.save(
      lot({ id: childId, name: 'Grandchild Lot', generation: 2, parentLotId: rootId }),
    )

    render(<YeastBankView />)
    await screen.findByText('Orphaned Root Lot')
    // The child rendered as a nested descendant, not a second flat orphan.
    expect(screen.getByText('Grandchild Lot')).toBeInTheDocument()

    fireEvent.click(within(nodeFor('Orphaned Root Lot')).getByRole('button', { name: /^delete$/i }))

    const message = confirmSpy.mock.calls[0][0] as string
    expect(message).toMatch(/1 child lot/i)
    expect(message).toMatch(/orphan/i)

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith(rootId))

    confirmSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('does not delete when the confirm is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const removeSpy = vi.spyOn(yeastLotsRepo, 'remove')

    const declinedId = U(8)
    await yeastLotsRepo.save(lot({ id: declinedId, name: 'Keep This Lot' }))

    render(<YeastBankView />)
    await screen.findByText('Keep This Lot')

    fireEvent.click(within(nodeFor('Keep This Lot')).getByRole('button', { name: /^delete$/i }))

    expect(removeSpy).not.toHaveBeenCalled()
    expect(await yeastLotsRepo.get(declinedId)).toBeDefined()

    confirmSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
