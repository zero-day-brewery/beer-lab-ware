// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryView } from '@/components/inventory/inventory-view'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const NOW_ISO = '2026-07-05T00:00:00.000Z'
const ID_A = '550e8400-e29b-41d4-a716-4466554400a1'

function inv(p: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return {
    ingredientKind: 'hop',
    amount: 100,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    schemaVersion: 1,
    ...p,
  }
}

/** All ledger txns for one item, chronological. */
async function ledger(itemId: string): Promise<StockTransaction[]> {
  const rows = await db.stockTransactions.where('inventoryItemId').equals(itemId).sortBy('at')
  return rows
}
const sumDeltas = (rows: StockTransaction[]) => rows.reduce((s, r) => s + r.delta, 0)

describe('InventoryView — stock-ledger wiring', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await db.inventoryItems.clear()
    await db.stockTransactions.clear()
    await db.seedTombstones.clear()
  })
  afterEach(async () => {
    await db.inventoryItems.clear()
    await db.stockTransactions.clear()
    vi.restoreAllMocks()
  })

  it('adding an item logs a restock txn equal to the initial amount (invariant holds)', async () => {
    render(<InventoryView />)
    fireEvent.click(await screen.findByRole('button', { name: /add item/i }))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Citra' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '454' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const item = (await db.inventoryItems.toArray()).find((r) => r.name === 'Citra')
      if (!item) throw new Error('Citra was not persisted yet')
      const rows = await ledger(item.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].reason).toBe('restock')
      expect(rows[0].delta).toBe(454)
      expect(sumDeltas(rows)).toBe(item.amount)
    })
  })

  it('editing the amount logs a manual-adjust txn for the signed difference', async () => {
    await db.inventoryItems.put(inv({ id: ID_A, name: 'Cascade', amount: 100 }))
    // Seed the opening txn so the item starts consistent.
    await db.stockTransactions.put({
      id: '11111111-1111-4111-8111-111111111111',
      inventoryItemId: ID_A,
      kind: 'hop',
      delta: 100,
      unit: 'g',
      reason: 'opening',
      at: '2026-07-04T00:00:00.000Z',
      schemaVersion: 1,
    })
    render(<InventoryView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    const amount = screen.getByLabelText('Amount')
    fireEvent.change(amount, { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const rows = await ledger(ID_A)
      expect(rows).toHaveLength(2)
      const adj = rows.find((r) => r.reason === 'manual-adjust')
      expect(adj?.delta).toBe(50)
      const item = await db.inventoryItems.get(ID_A)
      expect(item?.amount).toBe(150)
      expect(sumDeltas(rows)).toBe(150)
    })
  })

  it('a non-amount edit writes NO new txn', async () => {
    await db.inventoryItems.put(inv({ id: ID_A, name: 'Cascade', amount: 100 }))
    render(<InventoryView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Yakima' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await db.inventoryItems.get(ID_A))?.vendor).toBe('Yakima')
    })
    expect(await ledger(ID_A)).toHaveLength(0)
  })

  it('the Adjust modal routes a deduct through applyStockChange (amount + txn together)', async () => {
    await db.inventoryItems.put(inv({ id: ID_A, name: 'Cascade', amount: 100 }))
    await db.stockTransactions.put({
      id: '11111111-1111-4111-8111-111111111111',
      inventoryItemId: ID_A,
      kind: 'hop',
      delta: 100,
      unit: 'g',
      reason: 'opening',
      at: '2026-07-04T00:00:00.000Z',
      schemaVersion: 1,
    })
    render(<InventoryView />)
    fireEvent.click(await screen.findByRole('button', { name: /ledger/i }))

    // Switch to Remove, enter 30, submit.
    fireEvent.click(await screen.findByRole('button', { name: /Remove/ }))
    fireEvent.change(screen.getByLabelText('Adjust amount'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove stock' }))

    await waitFor(async () => {
      const item = await db.inventoryItems.get(ID_A)
      expect(item?.amount).toBe(70)
      const rows = await ledger(ID_A)
      expect(rows).toHaveLength(2)
      const spoil = rows.find((r) => r.reason === 'spoilage')
      expect(spoil?.delta).toBe(-30)
      expect(sumDeltas(rows)).toBe(70)
    })
  })

  it('deleting an item cascades its ledger transactions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await db.inventoryItems.put(inv({ id: ID_A, name: 'Cascade', amount: 100 }))
    await db.stockTransactions.put({
      id: '11111111-1111-4111-8111-111111111111',
      inventoryItemId: ID_A,
      kind: 'hop',
      delta: 100,
      unit: 'g',
      reason: 'opening',
      at: '2026-07-04T00:00:00.000Z',
      schemaVersion: 1,
    })
    render(<InventoryView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(async () => {
      expect(await db.inventoryItems.get(ID_A)).toBeUndefined()
      expect(await ledger(ID_A)).toHaveLength(0)
    })
  })
})
