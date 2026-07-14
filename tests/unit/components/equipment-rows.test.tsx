// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readingsRepo } from '@/lib/db/repos/readings'
import { db } from '@/lib/db/schema'
import { useSystemStore } from '@/stores/system-store'
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

beforeEach(async () => {
  await db.readings.clear()
  useSystemStore.getState().stopBrew()
  useSystemStore.getState().reset()
})

afterEach(async () => {
  await db.readings.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Brew Flow — three add/removable sections', () => {
  it('renders Brew Systems, Chillers & Coolers, and Fermenters', async () => {
    render(<SystemView />)
    expect(await screen.findByText('Brew Systems')).toBeInTheDocument()
    expect(screen.getByText('Chillers & Coolers')).toBeInTheDocument()
    expect(screen.getByText('Fermenters')).toBeInTheDocument()
  })
})

describe('EquipmentRow — expand for system / cooler / fermenter', () => {
  let restoreRO: () => void
  beforeEach(() => {
    restoreRO = installResizeObserver(600)
  })
  afterEach(() => {
    restoreRO()
  })

  it('expands a brew-system row to its settings detail', async () => {
    const user = userEvent.setup()
    render(<SystemView />)
    const summary = await screen.findByRole('button', { name: /Brewtools B40pro/i })
    expect(summary).toHaveAttribute('aria-expanded', 'false')

    await user.click(summary)

    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: /Brew System settings/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Brew System components')).toBeInTheDocument()
  })

  it('expands a cooler row and exposes its kind select', async () => {
    const user = userEvent.setup()
    render(<SystemView />)
    // Default coolers are glycol-only now (the counterflow lives in the brew system).
    const summary = await screen.findByRole('button', { name: /Penguin 1\/3 HP/i })

    await user.click(summary)

    expect(screen.getByRole('region', { name: /Glycol Cooler settings/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Glycol Cooler type/i })).toBeInTheDocument()
  })

  it('expands a fermenter row and still renders the mini fermentation chart', async () => {
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
    useSystemStore.setState({
      fermenters: [
        {
          id: 'f1',
          name: 'Fermenter 1',
          batch: 'Test Ale',
          status: 'fermenting',
          og: 1.05,
          sg: 1.02,
          fg: 1.01,
          batchId: BATCH_ID,
        },
      ],
    })
    render(<SystemView />)
    const summary = await screen.findByRole('button', { name: /Test Ale/i })

    await user.click(summary)

    expect(screen.getByRole('region', { name: /Test Ale controls/i })).toBeInTheDocument()
    // Mini-chart must not regress.
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
})

describe('EquipmentRow — +Add appends, delete removes', () => {
  it('+Add adds a brew system, a cooler, and a fermenter', async () => {
    const user = userEvent.setup()
    render(<SystemView />)
    await screen.findByText('Brew Systems')

    const b = useSystemStore.getState().brewSystems.length
    await user.click(screen.getByRole('button', { name: /Add brew system/i }))
    expect(useSystemStore.getState().brewSystems).toHaveLength(b + 1)

    const c = useSystemStore.getState().coolers.length
    await user.click(screen.getByRole('button', { name: /Add cooler/i }))
    expect(useSystemStore.getState().coolers).toHaveLength(c + 1)

    const f = useSystemStore.getState().fermenters.length
    await user.click(screen.getByRole('button', { name: /Add fermenter/i }))
    expect(useSystemStore.getState().fermenters).toHaveLength(f + 1)
  })

  it('the per-row delete removes an empty fermenter', async () => {
    const user = userEvent.setup()
    render(<SystemView />)
    await screen.findByText('Fermenters')

    const before = useSystemStore.getState().fermenters.length
    // f1 is empty in the seed, so removeFerm skips the confirm dialog.
    await user.click(screen.getByRole('button', { name: 'Remove Fermenter 1' }))
    expect(useSystemStore.getState().fermenters).toHaveLength(before - 1)
  })

  it('the per-row delete removes a cooler after the user confirms', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SystemView />)
    await screen.findByText('Chillers & Coolers')

    const before = useSystemStore.getState().coolers.length
    await user.click(screen.getByRole('button', { name: 'Remove Glycol Cooler' }))
    expect(useSystemStore.getState().coolers).toHaveLength(before - 1)
  })
})
