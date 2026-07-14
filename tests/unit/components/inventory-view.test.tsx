// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryView } from '@/components/inventory/inventory-view'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const NOW_ISO = '2026-07-05T00:00:00.000Z'

function inv(p: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return {
    ingredientKind: 'fermentable',
    amount: 1,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    schemaVersion: 1,
    ...p,
  }
}

const ID_A = '550e8400-e29b-41d4-a716-4466554400a1'
const ID_B = '550e8400-e29b-41d4-a716-4466554400b2'
const ID_C = '550e8400-e29b-41d4-a716-4466554400c3'

async function seed(items: InventoryItem[]) {
  await db.inventoryItems.bulkPut(items)
}

describe('InventoryView', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await db.inventoryItems.clear()
    await db.seedTombstones.clear()
  })
  afterEach(async () => {
    await db.inventoryItems.clear()
  })

  it('shows the total-value KPI rolled up across items', async () => {
    await seed([
      inv({ id: ID_A, name: 'Malt', amount: 10, pricePerUnit_USD: 2 }), // 20
      inv({ id: ID_B, name: 'Salt', amount: 4, pricePerUnit_USD: 0.5 }), // 2
    ])
    render(<InventoryView />)
    expect(await screen.findByText('$22.00')).toBeInTheDocument()
    expect(screen.getByText('Total value')).toBeInTheDocument()
  })

  it('filters by search across name and vendor', async () => {
    await seed([
      inv({ id: ID_A, name: 'Cascade pellets', vendor: 'Yakima' }),
      inv({ id: ID_B, name: 'Pilsner malt', vendor: 'Weyermann' }),
    ])
    render(<InventoryView />)
    await screen.findByText('Cascade pellets')

    fireEvent.change(screen.getByLabelText('Search by name or vendor'), {
      target: { value: 'weyermann' },
    })
    expect(screen.queryByText('Cascade pellets')).not.toBeInTheDocument()
    expect(screen.getByText('Pilsner malt')).toBeInTheDocument()
  })

  it('reorders items when the sort key changes', async () => {
    await seed([
      inv({ id: ID_A, name: 'Aaa', amount: 5 }),
      inv({ id: ID_B, name: 'Bbb', amount: 50 }),
      inv({ id: ID_C, name: 'Ccc', amount: 20 }),
    ])
    render(<InventoryView />)
    await screen.findByText('Aaa')

    // Default sort = name A→Z
    let titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Aaa', 'Bbb', 'Ccc'])

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'amount' } })
    titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Bbb', 'Ccc', 'Aaa']) // 50, 20, 5
  })

  it('toggles between card and table views', async () => {
    await seed([inv({ id: ID_A, name: 'Cascade pellets' })])
    render(<InventoryView />)
    await screen.findByText('Cascade pellets')

    // Default = cards (heading, no table)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Freshness')).toBeInTheDocument()
    expect(within(table).getByText('Cascade pellets')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the shopping list only when an item is under par', async () => {
    await seed([
      inv({ id: ID_A, name: 'Cascade', amount: 30, parLevel: 100, pricePerUnit_USD: 0.5 }),
    ])
    render(<InventoryView />)
    await screen.findByText('🛒 To buy')
    expect(screen.getByText(/buy 70 g/)).toBeInTheDocument()
  })

  it('hides the shopping list when nothing is under par', async () => {
    await seed([inv({ id: ID_A, name: 'Cascade', amount: 100, parLevel: 100 })])
    render(<InventoryView />)
    await screen.findByText('Cascade')
    expect(screen.queryByText('🛒 To buy')).not.toBeInTheDocument()
  })

  it('round-trips the new Opened-date and Par-level fields through the edit form', async () => {
    render(<InventoryView />)
    // Empty pantry → open the Add form
    fireEvent.click(await screen.findByRole('button', { name: /add item/i }))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nottingham' } })
    fireEvent.change(screen.getByLabelText('Par level'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'opened' } })
    fireEvent.change(screen.getByLabelText('Opened date'), { target: { value: '2026-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const rows = await db.inventoryItems.toArray()
      const saved = rows.find((r) => r.name === 'Nottingham') as InventoryItem | undefined
      expect(saved).toBeDefined()
      expect(saved?.parLevel).toBe(80)
      expect(saved?.openedDate?.slice(0, 10)).toBe('2026-01-01')
    })
  })

  it('true-empty pantry shows the brand scene', async () => {
    render(<InventoryView />)
    expect(await screen.findByText('The pantry is empty')).toBeInTheDocument()
    expect(document.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('kind-filtered empty keeps the text-only treatment (no brand scene)', async () => {
    await seed([inv({ id: ID_A, name: 'Malt' })]) // a fermentable — 'hop' filter matches nothing
    render(<InventoryView />)
    expect(await screen.findByText('Malt')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by kind'), { target: { value: 'hop' } })
    expect(await screen.findByText(/^No .+ yet$/)).toBeInTheDocument()
    expect(document.querySelector('.chip-icon')).not.toBeNull() // 🌾 chip kept
  })

  it('yeast filter shows a Yeast Bank link card, not the old panel', async () => {
    render(<InventoryView />)
    fireEvent.change(screen.getByLabelText('Filter by kind'), { target: { value: 'yeast' } })
    expect(await screen.findByRole('link', { name: /yeast bank/i })).toHaveAttribute(
      'href',
      '/yeast',
    )
  })
})
