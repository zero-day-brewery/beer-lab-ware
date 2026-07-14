// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FermStub = { id: string; name: string; batch: string; status: string }

const DEFAULT_FERMENTERS: FermStub[] = [
  { id: 'f1', name: 'Fermenter 1', batch: '', status: 'empty' },
  { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
]

// All values referenced inside vi.mock factories must come from vi.hoisted().
const h = vi.hoisted(() => ({
  push: vi.fn(),
  save: vi.fn(async (s: { id: string; yeastLotId?: string }) => s),
  setActive: vi.fn(),
  startBrew: vi.fn(),
  fermenters: [
    { id: 'f1', name: 'Fermenter 1', batch: '', status: 'empty' },
    { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
  ] as FermStub[],
  recipes: [] as unknown[],
  recommendedYeastLotId: '550e8400-e29b-41d4-a716-446655440077',
  // Mirrors makeSessionFromGate's real conditional-spread contract for
  // yeastLotId (see tests/unit/brewing/pitch-byte-identity.test.ts for the
  // real function's own byte-identity coverage) so this file's picker tests
  // can assert on the actual persisted-session key-set, not just call args.
  makeSession: vi.fn((i: { recipeName?: string; fermenterId?: string; yeastLotId?: string }) => ({
    id: 'new-sess',
    recipeName: i.recipeName,
    fermenterId: i.fermenterId,
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'first',
    resolvedSteps: ['first'],
    steps: {},
    choices: {},
    timers: [],
    startedAt: '',
    updatedAt: '',
    schemaVersion: 1 as const,
    ...(i.yeastLotId ? { yeastLotId: i.yeastLotId } : {}),
  })),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }))

vi.mock('@/lib/db/repos/session', () => ({
  sessionRepo: { save: (s: unknown) => h.save(s as { id: string }) },
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: { getState: () => ({ setActive: h.setActive }) },
}))

vi.mock('@/lib/brewing/process', () => ({
  BREW_MANUAL: { version: 1, stages: [] },
  MANUAL_VERSION: 1,
}))
vi.mock('@/lib/brewing/process/session', () => ({
  makeSessionFromGate: (i: unknown) =>
    h.makeSession(i as { recipeName?: string; fermenterId?: string; yeastLotId?: string }),
}))

// Minimal store mocks so the gate mounts. h.recipes defaults to [] → manual mode.
vi.mock('@/stores/recipes-store', () => ({ useRecipesStore: () => ({ recipes: h.recipes }) }))
vi.mock('@/stores/equipment-store', () => ({ useEquipmentStore: () => ({ profiles: [] }) }))
vi.mock('@/stores/water-profiles-store', () => ({
  useWaterProfilesStore: () => ({ profiles: [] }),
}))
vi.mock('@/stores/system-store', () => ({
  useSystemStore: (sel: (s: { startBrew: () => void; fermenters: FermStub[] }) => unknown) =>
    sel({ startBrew: h.startBrew, fermenters: h.fermenters }),
}))

// The water-chemistry readout isn't under test here — stub it out so a fixture
// recipe doesn't need a full calc-pipeline-shaped result.
vi.mock('@/components/system/use-water-plan', () => ({ useWaterPlan: () => null }))
vi.mock('@/lib/brewing/calc/pipeline', () => ({ calculateRecipe: vi.fn(() => ({ OG: 1.05 })) }))
// Fixed pitch recommendation so the yeast-lot picker tests are deterministic
// and independent of the pitch-rate/selection engines (covered separately in
// tests/unit/brewing/inventory/yeast-selection.test.ts).
vi.mock('@/lib/brewing/inventory/yeast-pitch-plan', () => ({
  planYeastPitch: vi.fn(() => ({
    pitch: { plato: 12, rate_M_per_mL_per_P: 0.75, cells_B: 100 },
    selection: {
      strain: 'California Ale',
      requiredCells_B: 100,
      chosen: {
        id: h.recommendedYeastLotId,
        name: 'WLP001 California Ale',
        strain: 'California Ale',
        form: 'liquid',
        productionDate: '2026-01-01T00:00:00.000Z',
        initialCells_B: 100,
        generation: 0,
        quantity: 1,
        unit: 'vial',
        notes_md: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        schemaVersion: 1,
      },
      chosenViabilityPct: 90,
      chosenViableCells_B: 90,
      action: 'pitch',
      starterRecommended: false,
      cellDeficit_B: 0,
      reason: 'ok',
      viableRanked: [],
    },
  })),
}))

import { BrewStartGate } from '@/components/system/brew-start-gate'

const RECIPE_WITH_YEAST = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Test IPA',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
  yeasts: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440002',
      snapshot: {
        name: 'WLP001 California Ale',
        attenuation_min_pct: 73,
        attenuation_max_pct: 80,
        form: 'liquid',
      },
      amount: 1,
    },
  ],
  miscs: [],
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

afterEach(() => {
  vi.clearAllMocks()
  h.fermenters = DEFAULT_FERMENTERS.map((f) => ({ ...f }))
  h.recipes = []
})

describe('BrewStartGate session creation', () => {
  it('confirm persists a BrewSession, hydrates the store, and routes to the runner', async () => {
    render(<BrewStartGate onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^Confirm/i }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].id).toBe('new-sess')
    expect(h.setActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-sess' }))
    expect(h.push).toHaveBeenCalledWith('/system/run/?session=new-sess')
  })

  it('skip persists a BrewSession with water.skipped and routes to the runner', async () => {
    render(<BrewStartGate onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].id).toBe('new-sess')
    expect(h.setActive).toHaveBeenCalled()
    expect(h.push).toHaveBeenCalledWith('/system/run/?session=new-sess')
  })
})

describe('BrewStartGate fermenter picker', () => {
  it('lists only empty vessels as options', () => {
    h.fermenters = [
      { id: 'f1', name: 'Fermenter 1', batch: '', status: 'empty' },
      { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
      { id: 'f3', name: 'Fermenter 3', batch: '', status: 'fermenting' },
    ]
    render(<BrewStartGate onClose={vi.fn()} />)
    const picker = screen.getByRole('combobox', { name: 'Fermenter' })
    const options = within(picker).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Fermenter 1', 'Fermenter 2'])
    expect(within(picker).queryByText('Fermenter 3')).toBeNull()
  })

  it('defaults to the first empty vessel and passes it to makeSessionFromGate', async () => {
    render(<BrewStartGate onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^Confirm/i }))
    await vi.waitFor(() => expect(h.makeSession).toHaveBeenCalled())
    expect(h.makeSession.mock.calls[0][0].fermenterId).toBe('f1')
  })

  it('passes the CHOSEN fermenterId into makeSessionFromGate', async () => {
    h.fermenters = [
      { id: 'seed-a', name: 'Fermenter A', batch: '', status: 'empty' },
      { id: 'seed-b', name: 'Fermenter B', batch: '', status: 'empty' },
    ]
    render(<BrewStartGate onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Fermenter' }), 'seed-b')
    await userEvent.click(screen.getByRole('button', { name: /^Confirm/i }))
    await vi.waitFor(() => expect(h.makeSession).toHaveBeenCalled())
    expect(h.makeSession.mock.calls[0][0].fermenterId).toBe('seed-b')
  })

  it('all vessels occupied disables both start actions and shows the hint', () => {
    h.fermenters = [
      { id: 'f1', name: 'Fermenter 1', batch: 'IPA', status: 'fermenting' },
      { id: 'f2', name: 'Fermenter 2', batch: 'Stout', status: 'cold-crash' },
    ]
    render(<BrewStartGate onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Confirm/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled()
    expect(
      screen.getByText('All fermenters are in use — free one on the Brew Flow board first'),
    ).toBeInTheDocument()
  })
})

describe('BrewStartGate yeast lot picker', () => {
  it('untouched picker falls back to the recommended lot', async () => {
    h.recipes = [RECIPE_WITH_YEAST]
    render(<BrewStartGate onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^Confirm/i }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].yeastLotId).toBe(h.recommendedYeastLotId)
  })

  it('explicitly clearing to "No lot recorded" overrides an existing recommendation — the launched session has no yeastLotId key', async () => {
    h.recipes = [RECIPE_WITH_YEAST]
    render(<BrewStartGate onClose={vi.fn()} />)
    const picker = screen.getByRole('combobox', { name: 'Yeast lot' })
    await userEvent.selectOptions(picker, '— No lot recorded —')
    await userEvent.click(screen.getByRole('button', { name: /^Confirm/i }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled())
    const session = h.save.mock.calls[0][0]
    expect('yeastLotId' in session).toBe(false)
  })
})
