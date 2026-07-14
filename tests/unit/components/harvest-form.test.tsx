// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { type YeastLot, YeastLotSchema } from '@/lib/brewing/types/yeast-lot'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { HarvestForm } from '@/components/yeast/harvest-form'

const U = (n: number) => `550e8400-e29b-41d4-a716-4466554400${n.toString().padStart(2, '0')}`
const PARENT_ID = U(1)
const BATCH_ID = U(2)
const OTHER_LOT_ID = U(3)

/** A parent lot harvested "now" — near-100% viable for its form, so a
 *  reasonable slurry volume yields a positive cell estimate regardless of
 *  the real wall-clock date the test suite runs on. */
function freshLot(p: Partial<YeastLot> & { id: string }): YeastLot {
  const now = new Date().toISOString()
  return {
    name: 'WLP001 California Ale',
    strain: 'California Ale',
    form: 'slurry',
    productionDate: now,
    initialCells_B: 300,
    generation: 0,
    quantity: 250,
    unit: 'mL',
    notes_md: '',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    ...p,
  }
}

/** A parent lot harvested decades ago — 0% viability under every decline
 *  curve, so `planHarvest` always estimates 0 cells (the "dead parent" case). */
function deadLot(p: Partial<YeastLot> & { id: string }): YeastLot {
  return {
    name: 'WLP001 California Ale',
    strain: 'California Ale',
    form: 'slurry',
    productionDate: '2000-01-01T00:00:00.000Z',
    initialCells_B: 300,
    generation: 0,
    quantity: 250,
    unit: 'mL',
    notes_md: '',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    schemaVersion: 1,
    ...p,
  }
}

function recipeWithYeast(name: string): Recipe {
  const iso = '2026-07-01T00:00:00.000Z'
  return {
    id: U(8),
    name: 'Test Recipe',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: U(7),
    fermentables: [],
    hops: [],
    yeasts: [
      {
        ingredientId: U(9),
        snapshot: { name, attenuation_min_pct: 70, attenuation_max_pct: 80, form: 'liquid' },
        amount: 1,
      },
    ],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: iso,
    updatedAt: iso,
    schemaVersion: 1,
  }
}

function sampleBatch(p: Partial<Batch> = {}): Batch {
  return {
    id: BATCH_ID,
    batchNo: 3,
    name: 'Test Batch',
    status: 'in-progress',
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    ...p,
  }
}

describe('HarvestForm', () => {
  beforeEach(async () => {
    await db.yeastLots.clear()
  })

  it('given a parent lot, renders the planHarvest preview and enables Confirm once volume is entered', async () => {
    const user = userEvent.setup()
    const parent = freshLot({ id: PARENT_ID, generation: 1 })
    render(<HarvestForm parentLot={parent} onDone={vi.fn()} />)

    expect(screen.getByRole('button', { name: /confirm harvest/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/slurry volume/i), '200')

    expect(screen.getByText(/estimated cells/i)).toBeInTheDocument()
    expect(screen.getByText(/gen 2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm harvest/i })).toBeEnabled()
  })

  it('disables Confirm when the estimated cells are zero (dead parent)', async () => {
    const user = userEvent.setup()
    const parent = deadLot({ id: PARENT_ID })
    render(<HarvestForm parentLot={parent} onDone={vi.fn()} />)

    await user.type(screen.getByLabelText(/slurry volume/i), '200')

    expect(screen.getByRole('button', { name: /confirm harvest/i })).toBeDisabled()
    expect(screen.getByText(/cannot save this harvest/i)).toBeInTheDocument()
  })

  it('on Confirm saves a stamped, Zod-valid child linked to the parent with the date normalized to full ISO', async () => {
    const user = userEvent.setup()
    const parent = freshLot({ id: PARENT_ID, generation: 1 })
    const onDone = vi.fn()
    render(<HarvestForm parentLot={parent} onDone={onDone} />)

    await user.type(screen.getByLabelText(/slurry volume/i), '200')
    fireEvent.change(screen.getByLabelText(/harvest date/i), { target: { value: '2026-07-01' } })
    await user.click(screen.getByRole('button', { name: /confirm harvest/i }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())

    const rows = await db.yeastLots.toArray()
    const child = rows.find((r) => r.id !== PARENT_ID)
    expect(child).toBeDefined()
    expect(() => YeastLotSchema.parse(child)).not.toThrow()
    expect(child?.parentLotId).toBe(PARENT_ID)
    expect(child?.harvestedFromBatchId).toBeUndefined()
    expect(child?.generation).toBe(2)
    // The <input type="date"> value 'YYYY-MM-DD' must be normalized to a full
    // ISO datetime before it ever reaches YeastLotSchema (z.string().datetime()).
    expect(child?.productionDate).toBe('2026-07-01T00:00:00.000Z')
  })

  it('batch case: resolves the recorded parent via batch.yeastLotId (no picker) and links harvestedFromBatchId', async () => {
    const user = userEvent.setup()
    const parent = freshLot({ id: PARENT_ID, generation: 0 })
    await db.yeastLots.put(parent)
    const batch = sampleBatch({ yeastLotId: PARENT_ID })
    const onDone = vi.fn()
    render(<HarvestForm batch={batch} onDone={onDone} />)

    expect(await screen.findByText(/WLP001 California Ale/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/parent lot/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/slurry volume/i), '150')
    await user.click(screen.getByRole('button', { name: /confirm harvest/i }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const rows = await db.yeastLots.toArray()
    const child = rows.find((r) => r.id !== PARENT_ID)
    expect(child?.parentLotId).toBe(PARENT_ID)
    expect(child?.harvestedFromBatchId).toBe(BATCH_ID)
  })

  it('batch case: no recorded pitch — the picker defaults to a name-based match against the recipe snapshot yeast', async () => {
    const matching = freshLot({
      id: PARENT_ID,
      name: 'WLP001 California Ale',
      strain: 'California Ale',
    })
    const distractor = freshLot({ id: OTHER_LOT_ID, name: 'US-05', strain: 'American Ale' })
    await db.yeastLots.bulkPut([matching, distractor])
    const batch = sampleBatch({ recipeSnapshot: recipeWithYeast('WLP001 California Ale') })
    render(<HarvestForm batch={batch} onDone={vi.fn()} />)

    const select = await screen.findByLabelText(/parent lot/i)
    await waitFor(() => expect(select).toHaveValue(PARENT_ID))
    expect(screen.queryByText(/didn't record the pitch/i)).not.toBeInTheDocument()
  })

  it('batch case: manual batch (no recipeSnapshot) opens an unfiltered picker, no default, with the "no recorded pitch" label', async () => {
    const lotA = freshLot({ id: PARENT_ID, name: 'WLP001 California Ale' })
    const lotB = freshLot({ id: OTHER_LOT_ID, name: 'US-05' })
    await db.yeastLots.bulkPut([lotA, lotB])
    const batch = sampleBatch()
    render(<HarvestForm batch={batch} onDone={vi.fn()} />)

    expect(await screen.findByText(/didn't record the pitch/i)).toBeInTheDocument()
    const select = await screen.findByLabelText(/parent lot/i)
    expect(select).toHaveValue('')
    // Options are populated by an async Dexie liveQuery (see `useAllYeastLots`
    // in harvest-form.tsx) — the <select> itself renders before the lots
    // arrive, so wait for the option count rather than reading it synchronously.
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3))
  })
})
