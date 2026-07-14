// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GearView } from '@/components/gear/gear-view'
import type { GearItem } from '@/lib/brewing/types/gear'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const NOW_ISO = '2026-07-05T00:00:00.000Z'

let seq = 0
function gear(p: Partial<GearItem> & { name: string }): GearItem {
  seq += 1
  return {
    id: `550e8400-e29b-41d4-a716-4466554400${String(seq).padStart(2, '0')}`,
    category: 'other',
    condition: 'good',
    notes_md: '',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    schemaVersion: 1,
    ...p,
  }
}

async function seed(items: GearItem[]) {
  await db.gearItems.bulkPut(items)
}

/** The row's collapsed summary is the one <button> carrying aria-expanded (the
 *  per-row delete shares the item name via its aria-label). */
function summaryButton(name: RegExp): HTMLElement {
  const b = screen.getAllByRole('button', { name }).find((el) => el.hasAttribute('aria-expanded'))
  if (!b) throw new Error(`no summary button for ${name}`)
  return b
}

describe('GearView', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await db.gearItems.clear()
    await db.seedTombstones.clear()
  })
  afterEach(async () => {
    await db.gearItems.clear()
  })

  it('defaults to grouped rows with a per-category header (count + value)', async () => {
    // A second, differently-priced category keeps the kegging group total ($150)
    // distinct from the cellar-wide "Value" tile ($170).
    await seed([
      gear({ name: 'Corny Keg', category: 'kegging', pricePaid_USD: 100 }),
      gear({ name: 'Second Keg', category: 'kegging', pricePaid_USD: 50 }),
      gear({ name: 'Thermometer', category: 'instrument', pricePaid_USD: 20 }),
    ])
    render(<GearView />)
    // Group header shows label + summed value; no cards (no <h3>).
    const header = await screen.findByRole('button', { name: /Kegging/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('$150')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    expect(screen.getByText('Corny Keg')).toBeInTheDocument()
  })

  it('single-expands: opening one row closes the previously open one', async () => {
    await seed([
      gear({ name: 'Kettle Alpha', category: 'kettle', notes_md: 'note-alpha' }),
      gear({ name: 'Kettle Beta', category: 'kettle', notes_md: 'note-beta' }),
    ])
    render(<GearView />)
    await screen.findByText('Kettle Alpha')

    // Collapsed → no detail notes visible.
    expect(screen.queryByText('note-alpha')).not.toBeInTheDocument()

    fireEvent.click(summaryButton(/Kettle Alpha/))
    expect(screen.getByText('note-alpha')).toBeInTheDocument()
    expect(screen.queryByText('note-beta')).not.toBeInTheDocument()

    // Opening Beta closes Alpha (one at a time).
    fireEvent.click(summaryButton(/Kettle Beta/))
    expect(screen.getByText('note-beta')).toBeInTheDocument()
    expect(screen.queryByText('note-alpha')).not.toBeInTheDocument()
  })

  it('toggles between grouped rows and the card grid', async () => {
    await seed([gear({ name: 'Corny Keg', category: 'kegging' })])
    render(<GearView />)
    await screen.findByText('Corny Keg')

    // Default = rows: group header present, no card headings.
    expect(screen.getByRole('button', { name: /Kegging/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Corny Keg' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Kegging/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rows' }))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('collapses a category section without losing others', async () => {
    await seed([
      gear({ name: 'Corny Keg', category: 'kegging' }),
      gear({ name: 'Hydrometer', category: 'instrument' }),
    ])
    render(<GearView />)
    await screen.findByText('Corny Keg')

    fireEvent.click(screen.getByRole('button', { name: /Kegging/ }))
    expect(screen.queryByText('Corny Keg')).not.toBeInTheDocument()
    // The instrument section is untouched.
    expect(screen.getByText('Hydrometer')).toBeInTheDocument()
  })

  it('narrows results with the category filter', async () => {
    await seed([
      gear({ name: 'Corny Keg', category: 'kegging' }),
      gear({ name: 'Hydrometer', category: 'instrument' }),
    ])
    render(<GearView />)
    await screen.findByText('Corny Keg')

    fireEvent.change(screen.getByLabelText('Filter by category'), {
      target: { value: 'instrument' },
    })
    expect(screen.queryByText('Corny Keg')).not.toBeInTheDocument()
    expect(screen.getByText('Hydrometer')).toBeInTheDocument()
  })

  it('narrows results with search across name/brand/location', async () => {
    await seed([
      gear({ name: 'Corny Keg', category: 'kegging', brand: 'AEB' }),
      gear({ name: 'Hydrometer', category: 'instrument', location: 'Toolbox' }),
    ])
    render(<GearView />)
    await screen.findByText('Corny Keg')

    fireEvent.change(screen.getByLabelText('Search gear'), { target: { value: 'toolbox' } })
    expect(screen.queryByText('Corny Keg')).not.toBeInTheDocument()
    expect(screen.getByText('Hydrometer')).toBeInTheDocument()
  })

  it('shows the empty state when the cellar has no items', async () => {
    render(<GearView />)
    expect(await screen.findByText('The cellar is empty')).toBeInTheDocument()
  })

  it('adds a gear item through the Add form (CRUD intact)', async () => {
    render(<GearView />)
    fireEvent.click(await screen.findByRole('button', { name: /add gear/i }))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ss BrewBucket' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'fermenter' } })
    fireEvent.change(screen.getByLabelText('Price paid (USD)'), { target: { value: '199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const rows = await db.gearItems.toArray()
      const saved = rows.find((r) => r.name === 'Ss BrewBucket') as GearItem | undefined
      expect(saved).toBeDefined()
      expect(saved?.category).toBe('fermenter')
      expect(saved?.pricePaid_USD).toBe(199)
    })
  })

  it('opens the edit form from an expanded row (edit wiring intact)', async () => {
    await seed([gear({ name: 'Kettle Alpha', category: 'kettle' })])
    render(<GearView />)
    await screen.findByText('Kettle Alpha')

    fireEvent.click(summaryButton(/Kettle Alpha/))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: /Edit "Kettle Alpha"/ })).toBeInTheDocument()
  })
})
