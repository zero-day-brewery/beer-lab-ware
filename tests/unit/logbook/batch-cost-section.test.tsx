// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'

const listByBatchMock = vi.fn()
const listItemsMock = vi.fn()
vi.mock('@/lib/db/repos/stock-transactions', () => ({
  stockTransactionsRepo: { listByBatch: (...a: unknown[]) => listByBatchMock(...a) },
}))
vi.mock('@/lib/db/repos/inventory', () => ({
  inventoryRepo: { list: (...a: unknown[]) => listItemsMock(...a) },
}))

import { BatchCostSection } from '@/components/logbook/batch-cost-section'

const BATCH_ID = '22222222-2222-4222-8222-222222222222'

const batch = {
  id: BATCH_ID,
  batchNo: 4,
  name: 'SMaSH #4',
  status: 'complete',
  process: [],
  logs: [],
  timers: [],
  results: { intoFermenter_L: 20 },
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
} as unknown as Batch

function item(overrides: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return {
    ingredientKind: 'fermentable',
    amount: 10,
    amountUnit: 'kg',
    status: 'sealed',
    notes_md: '',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  }
}

function deduct(
  overrides: Partial<StockTransaction> & { id: string; inventoryItemId: string; delta: number },
): StockTransaction {
  return {
    kind: 'fermentable',
    unit: 'kg',
    reason: 'brew-deduct',
    batchId: BATCH_ID,
    at: '2026-06-25T12:30:00.000Z',
    schemaVersion: 1,
    ...overrides,
  }
}

const PALE = item({
  id: '11111111-0000-4000-8000-000000000001',
  name: 'Pale Malt',
  pricePerUnit_USD: 2.5,
})
const UNPRICED = item({
  id: '11111111-0000-4000-8000-000000000002',
  name: 'US-05',
  ingredientKind: 'yeast',
  amountUnit: 'packets',
})

describe('BatchCostSection', () => {
  beforeEach(() => {
    listByBatchMock.mockReset()
    listItemsMock.mockReset()
    listItemsMock.mockResolvedValue([PALE, UNPRICED])
  })

  it('renders costed lines, the USD total, and cost per liter for a fully priced batch', async () => {
    listByBatchMock.mockResolvedValue([deduct({ id: 't1', inventoryItemId: PALE.id, delta: -5 })])
    render(<BatchCostSection batch={batch} />)

    await waitFor(() => expect(screen.getByText('Pale Malt')).toBeInTheDocument())
    expect(listByBatchMock).toHaveBeenCalledWith(BATCH_ID)
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.getByTestId('batch-cost-summary')).toHaveTextContent('$12.50 USD')
    // 12.50 / 20 L
    expect(screen.getByTestId('batch-cost-summary')).toHaveTextContent('$0.63 / L')
    expect(screen.queryByText(/unpriced/)).not.toBeInTheDocument()
  })

  it('lists unpriced lines with em-dash cells and surfaces the "n items unpriced" note', async () => {
    listByBatchMock.mockResolvedValue([
      deduct({ id: 't1', inventoryItemId: PALE.id, delta: -5 }),
      deduct({ id: 't2', inventoryItemId: UNPRICED.id, delta: -1, kind: 'yeast', unit: 'packets' }),
    ])
    render(<BatchCostSection batch={batch} />)

    await waitFor(() => expect(screen.getByText('US-05')).toBeInTheDocument())
    expect(screen.getByText(/1 item unpriced — excluded from the total/)).toBeInTheDocument()
    // Total still only counts the priced line.
    expect(screen.getByTestId('batch-cost-summary')).toHaveTextContent('$12.50 USD')
  })

  it('shows no total and a full unpriced note when nothing has a price', async () => {
    listByBatchMock.mockResolvedValue([
      deduct({ id: 't2', inventoryItemId: UNPRICED.id, delta: -2, kind: 'yeast', unit: 'packets' }),
    ])
    render(<BatchCostSection batch={batch} />)

    await waitFor(() => expect(screen.getByText('US-05')).toBeInTheDocument())
    expect(screen.getByText(/1 item unpriced/)).toBeInTheDocument()
    expect(screen.getByTestId('batch-cost-summary')).toHaveTextContent('$0.00 USD')
    // No cost/L claim when nothing is priced.
    expect(screen.getByTestId('batch-cost-summary')).not.toHaveTextContent('/ L')
  })

  it('renders a quiet empty state when the batch has no ledger movements', async () => {
    listByBatchMock.mockResolvedValue([])
    render(<BatchCostSection batch={batch} />)

    await waitFor(() =>
      expect(
        screen.getByText(/No ingredient movements are linked to this batch/),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('batch-cost-summary')).not.toBeInTheDocument()
  })
})
