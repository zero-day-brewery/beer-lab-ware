// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readingsRepo } from '@/lib/db/repos/readings'
import { db } from '@/lib/db/schema'
import { type Fermenter, useSystemStore } from '@/stores/system-store'
import { installResizeObserver } from '../../helpers/resize-observer'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
// Stable loadActive stub — SystemView calls it once on mount to hydrate the pointer.
const loadActive = vi.hoisted(() => vi.fn())
vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({ session: null, loadActive }),
}))

import { SystemView } from '@/components/system/system-view'

const BATCH_ID = '99999999-9999-4999-8999-999999999999'

const ferm = (over: Partial<Fermenter> & Pick<Fermenter, 'id' | 'name'>): Fermenter => ({
  batch: '',
  status: 'empty',
  ...over,
})

/** A fermenting vessel with gravity, temp, and a 75% progress readout. */
const hazy = (): Fermenter =>
  ferm({
    id: 'f1',
    name: 'Fermenter 1',
    batch: 'Hazy IPA',
    status: 'fermenting',
    og: 1.05,
    sg: 1.02,
    fg: 1.01,
    tempCurrent: 68,
    tempTarget: 66,
  })

const stout = (): Fermenter =>
  ferm({ id: 'f2', name: 'Fermenter 2', batch: 'Stout', status: 'conditioning' })

function setFerms(list: Fermenter[]) {
  useSystemStore.setState({ fermenters: list })
}

beforeEach(async () => {
  await db.readings.clear()
  // Focus these tests on the fermenter section — clear the machine sections so
  // only fermenter rows render (setFerms below supplies the fermenters).
  useSystemStore.setState({ brewSystems: [], coolers: [] })
})

afterEach(async () => {
  await db.readings.clear()
  vi.clearAllMocks()
})

describe('FermenterRow — collapsed summary', () => {
  it('renders the summary (name, status, SG, temp, progress) and stays collapsed', async () => {
    setFerms([hazy(), stout()])
    render(<SystemView />)
    const summary = await screen.findByRole('button', { name: /Hazy IPA/i })

    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Fermenting')).toBeInTheDocument()
    expect(screen.getByText('1.020')).toBeInTheDocument()
    expect(screen.getByText('68/66')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    // Collapsed rows do not mount their detail panel.
    expect(screen.queryByRole('region', { name: /Hazy IPA controls/i })).not.toBeInTheDocument()
  })
})

describe('FermenterRow — cinematic single-expand', () => {
  it('clicking the summary expands the row (detail visible, aria-expanded true)', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    const summary = await screen.findByRole('button', { name: /Hazy IPA/i })

    await user.click(summary)

    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: /Hazy IPA controls/i })).toBeInTheDocument()
    // A relocated control is now reachable in the expanded panel.
    expect(screen.getByLabelText('Current gravity')).toBeInTheDocument()
  })

  it('opening a second row collapses the first (only one open at a time)', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)

    const first = await screen.findByRole('button', { name: /Hazy IPA/i })
    await user.click(first)
    expect(screen.getByRole('region', { name: /Hazy IPA controls/i })).toBeInTheDocument()

    const second = screen.getByRole('button', { name: /Stout/i })
    await user.click(second)

    expect(screen.getByRole('region', { name: /Stout controls/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Hazy IPA controls/i })).not.toBeInTheDocument()
    expect(first).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('FermenterRow — controls still write through the store', () => {
  it('editing gravity in the expanded panel patches the fermenter', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    fireEvent.change(screen.getByLabelText('Current gravity'), { target: { value: '1.030' } })

    const f1 = useSystemStore.getState().fermenters.find((f) => f.id === 'f1')
    expect(f1?.sg).toBe(1.03)
  })
})

describe('FermenterRow — vessel rename', () => {
  it('the Name field shows the vessel name (not the batch/recipe summary label)', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    // Summary reads the batch ("Hazy IPA"); the Name field reads the vessel ("Fermenter 1").
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    expect(screen.getByLabelText('Fermenter name')).toHaveValue('Fermenter 1')
  })

  it('editing the Name field patches the fermenter with the typed value', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    fireEvent.change(screen.getByLabelText('Fermenter name'), { target: { value: 'Conical #1' } })

    const f1 = useSystemStore.getState().fermenters.find((f) => f.id === 'f1')
    expect(f1?.name).toBe('Conical #1')
    // Vessel rename must NOT touch the batch/recipe precedence used by the summary.
    expect(f1?.batch).toBe('Hazy IPA')
  })

  it('an empty / whitespace-only name is skipped — the vessel keeps its prior name', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    const input = screen.getByLabelText('Fermenter name')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '   ' } })

    const f1 = useSystemStore.getState().fermenters.find((f) => f.id === 'f1')
    expect(f1?.name).toBe('Fermenter 1')
  })

  it('renaming leaves the rest of the detail intact (vitals still reachable)', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    fireEvent.change(screen.getByLabelText('Fermenter name'), { target: { value: 'Conical #1' } })

    // The relocated gravity control still lives in the expanded detail post-rename.
    expect(screen.getByLabelText('Current gravity')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Hazy IPA controls/i })).toBeInTheDocument()
  })
})

describe('FermRowChart — mini fermentation chart', () => {
  let restoreRO: () => void
  beforeEach(() => {
    restoreRO = installResizeObserver(600)
  })
  afterEach(() => {
    restoreRO()
  })

  it('draws the gravity/temp paths when the linked batch has readings', async () => {
    const user = userEvent.setup()
    await readingsRepo.create({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      batchId: BATCH_ID,
      at: '2026-07-01T12:00:00.000Z',
      gravity: 1.05,
      tempC: 20,
      schemaVersion: 1,
    })
    await readingsRepo.create({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      batchId: BATCH_ID,
      at: '2026-07-03T12:00:00.000Z',
      gravity: 1.02,
      tempC: 19,
      schemaVersion: 1,
    })
    setFerms([{ ...hazy(), batchId: BATCH_ID }, stout()])
    render(<SystemView />)
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    await waitFor(() => {
      expect(document.querySelector('[data-testid="fermentation-chart"]')).not.toBeNull()
    })
    expect(
      document
        .querySelector('[data-series-id="gravity"] path.chart-series-line')
        ?.getAttribute('d'),
    ).toBeTruthy()
    expect(
      document.querySelector('[data-series-id="temp"] path.chart-series-line')?.getAttribute('d'),
    ).toBeTruthy()
  })

  it('shows the link-a-batch hint when the fermenter has no batch linked', async () => {
    const user = userEvent.setup()
    setFerms([hazy(), stout()])
    render(<SystemView />)
    await user.click(await screen.findByRole('button', { name: /Hazy IPA/i }))

    expect(screen.getByText(/link a batch to see the fermentation curve/i)).toBeInTheDocument()
    expect(document.querySelector('[data-testid="fermentation-chart"]')).toBeNull()
  })
})
