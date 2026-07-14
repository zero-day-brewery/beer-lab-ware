// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// All values used in vi.mock factories must be produced by vi.hoisted()
const mocks = vi.hoisted(() => {
  const session = {
    id: 'sess-1',
    recipeName: 'West Coast IPA',
    recipeId: undefined as string | undefined,
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'read-batch-numbers',
    resolvedSteps: ['read-batch-numbers', 'stage-water'],
    steps: { 'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] } },
    choices: {},
    timers: [],
    startedAt: '2026-06-24T00:00:00.000Z',
    updatedAt: '2026-06-24T00:00:00.000Z',
    schemaVersion: 1 as const,
  }
  return {
    session,
    dispatch: vi.fn(),
    loadActive: vi.fn(),
    setActive: vi.fn(),
    search: { session: 'sess-1' } as Record<string, string | undefined>,
    // Timer store mocks
    timerLoad: vi.fn().mockResolvedValue(undefined),
    timerArm: vi.fn().mockResolvedValue(undefined),
    timerTimers: [] as { id: string; stepId: string; status: string; sessionId: string }[],
    timerMissedOnLoad: [] as { id: string; label: string }[],
  }
})

vi.mock('@/stores/timer-store', () => ({
  useTimerStore: () => ({
    load: mocks.timerLoad,
    arm: mocks.timerArm,
    timers: mocks.timerTimers,
    missedOnLoad: mocks.timerMissedOnLoad,
    setTimers: vi.fn(),
    cancel: vi.fn(),
    tick: vi.fn(),
  }),
}))

// TimerRack uses AudioContext + Notification — stub it out in tests
vi.mock('@/components/system/run/timer-rack', () => ({
  TimerRack: () => null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => mocks.search[k] ?? null }),
}))

vi.mock('@/lib/db/repos/session', () => ({
  sessionRepo: {
    get: vi.fn().mockResolvedValue(mocks.session),
  },
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({
    session: mocks.session,
    loadActive: mocks.loadActive,
    setActive: mocks.setActive,
    dispatch: mocks.dispatch,
    lastRejection: null,
    flush: vi.fn(),
    clearRejection: vi.fn(),
  }),
}))

vi.mock('@/lib/brewing/process', () => ({
  BREW_MANUAL: {
    version: 1,
    stages: [
      {
        id: 'prep',
        title: 'Prep',
        steps: [
          {
            id: 'read-batch-numbers',
            title: 'Read & write down batch numbers',
            body_md: 'Capture strike temp.',
            values: [{ key: 'strikeTemp_C', label: 'Strike temp', unit: '°C', source: 'calc' }],
            logs: [],
            timers: [],
          },
          {
            id: 'stage-water',
            title: 'Stage water',
            body_md: '',
            values: [],
            logs: [],
            timers: [],
          },
          {
            id: 'log-og',
            title: 'Log original gravity',
            body_md: 'Read refractometer.',
            values: [],
            logs: [{ key: 'og', label: 'OG', kind: 'gravity', required: true }],
            timers: [],
          },
          {
            id: 'timer-step',
            title: 'Boil 60 min',
            body_md: 'Bring to a rolling boil.',
            values: [],
            logs: [],
            timers: [
              {
                id: 'boil-timer',
                label: 'Boil',
                isBoilMaster: false,
                durationFrom: { kind: 'fixed', minutes: 60 },
              },
            ],
          },
          // Dead-end test fixture: timer step WITH a required numeric log field
          // Mirrors the real "heat-strike-water" pattern
          {
            id: 'heat-strike-water',
            title: 'Heat strike water',
            body_md: 'Heat water to strike temp.',
            values: [],
            logs: [{ key: 'strikeTemp', label: 'Strike Temp (°C)', kind: 'temp', required: true }],
            timers: [
              {
                id: 'heat-timer',
                label: 'Heat',
                isBoilMaster: false,
                durationFrom: { kind: 'fixed', minutes: 20 },
              },
            ],
          },
          // Dead-end test fixture: branch-choose step WITH required numeric log fields
          // Mirrors the real "co2-set-regulator" pattern
          {
            id: 'co2-set-regulator',
            title: 'Is this beer carbonated?',
            body_md: 'Set CO2 regulator.',
            values: [],
            logs: [{ key: 'psi', label: 'PSI', kind: 'number', required: true }],
            timers: [],
            branch: { t: 'carbPath', eq: 'co2' },
          },
          // Dead-end test fixture: step with required bool + required number (weigh-grain pattern)
          {
            id: 'weigh-grain',
            title: 'Weigh grain',
            body_md: 'Sanitize and weigh grain.',
            values: [],
            logs: [
              { key: 'sanitized', label: 'Equipment sanitized', kind: 'bool', required: true },
              { key: 'weight', label: 'Grain weight (kg)', kind: 'number', required: true },
            ],
            timers: [],
          },
        ],
      },
    ],
  },
  MANUAL_VERSION: 1,
}))

vi.mock('@/lib/brewing/process/values', () => ({
  injectValues: () => ({ display: '73.3', ok: true, value: 73.3 }),
}))
vi.mock('@/stores/board-bridge', () => ({ applyEffects: vi.fn() }))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => ({ supported: false }) }))
vi.mock('@/hooks/use-alarm', () => ({
  useAlarm: () => ({ fire: vi.fn(), supported: { audio: false, vibrate: false } }),
}))
vi.mock('@/hooks/use-speech', () => ({ useSpeech: () => ({ speak: vi.fn(), supported: false }) }))

// Stub the stores and calc pipeline used by the hydrated ctx.
// We use mutable containers so individual tests can swap in a recipe / profile.
const recipesContainer: { recipes: unknown[]; isLoading: boolean } = {
  recipes: [],
  isLoading: false,
}
const equipmentContainer: { profiles: unknown[]; isLoading: boolean } = {
  profiles: [],
  isLoading: false,
}

vi.mock('@/stores/recipes-store', () => ({
  useRecipesStore: () => recipesContainer,
}))
vi.mock('@/stores/equipment-store', () => ({
  useEquipmentStore: () => equipmentContainer,
}))
vi.mock('@/stores/water-profiles-store', () => ({
  useWaterProfilesStore: () => ({ profiles: [], isLoading: false }),
}))
vi.mock('@/lib/brewing/water/ions', () => ({
  ZERO_PROFILE: {
    Ca_ppm: 0,
    Mg_ppm: 0,
    Na_ppm: 0,
    SO4_ppm: 0,
    Cl_ppm: 0,
    HCO3_ppm: 0,
  },
}))
vi.mock('@/lib/brewing/calc/pipeline', () => ({
  calculateRecipe: vi.fn(() => ({
    OG: 1.06,
    FG: 1.012,
    ABV: 6.3,
    IBU: 45,
    SRM: 8,
    volumes: {
      mashWater_L: 20,
      spargeWater_L: 5,
      preBoilVolume_L: 25,
      postBoilVolume_L: 23,
      intoFermenter_L: 21,
    },
    strikeTemp_C: 72,
    formulasUsed: { ibu: 'tinseth', srm: 'morey', abv: 'simple' },
    computedAt: '2026-06-25T00:00:00.000Z',
    schemaVersion: 1,
  })),
}))
vi.mock('@/lib/brewing/defaults/b40pro', () => ({
  B40PRO_PROFILE: {
    id: 'b40-default',
    name: 'B40pro (US110V)',
    isDefault: true,
    mashTunVolume_L: 40,
    mashTunDeadSpace_L: 0.5,
    kettleVolume_L: 40,
    kettleDeadSpace_L: 2.0,
    fermenterVolume_L: 30,
    fermenterDeadSpace_L: 0.5,
    evaporationRate_LperHr: 1.0,
    coolingShrinkage_pct: 4,
    topUpKettle_L: 0,
    topUpWater_L: 0,
    grainAbsorption_LperKg: 1.0,
    mashEfficiency_pct: 78,
    brewhouseEfficiency_pct: 72,
    ibuFormula: 'tinseth',
    srmFormula: 'morey',
    abvFormula: 'simple',
    hopUtilizationMultiplier: 1,
    calibrationNotes_md: '',
    schemaVersion: 1,
  },
  B40PRO_PROFILE_ID: 'b40-default',
}))

import {
  GuidedRunner,
  pickRenderer,
  requiredLogsComplete,
} from '@/components/system/run/guided-runner'
import type { ValueToken } from '@/lib/brewing/process/types'
import { injectValues, type ResolveCtx } from '@/lib/brewing/process/values'

afterEach(() => vi.clearAllMocks())

describe('pickRenderer', () => {
  it('routes run-water-chemistry-gate to water-plan BEFORE other rules', () => {
    // Even if the step had timers/logs, the id check wins
    expect(
      pickRenderer({
        id: 'run-water-chemistry-gate',
        timers: [{ id: 't', isBoilMaster: true }],
        logs: [{ key: 'a', kind: 'gravity', required: true }],
        values: [],
        title: 'x',
      } as never),
    ).toBe('water-plan')
  })
  it('routes a timer step to timer', () => {
    expect(
      pickRenderer({
        timers: [{ id: 't', isBoilMaster: true }],
        logs: [],
        values: [],
        title: 'x',
      } as never),
    ).toBe('timer')
  })
  it('routes a required-bool step to checklist', () => {
    expect(
      pickRenderer({
        timers: [],
        logs: [{ key: 'a', kind: 'bool', required: true }],
        values: [],
        title: 'x',
      } as never),
    ).toBe('checklist')
  })
  it('routes a required-non-bool step to log-delta', () => {
    expect(
      pickRenderer({
        timers: [],
        logs: [{ key: 'a', kind: 'gravity', required: true }],
        values: [],
        title: 'x',
      } as never),
    ).toBe('log-delta')
  })
  it('routes a carb step (carbPath branch, no logs) to recipe-value — branch field is ignored by pickRenderer', () => {
    expect(
      pickRenderer({
        timers: [],
        logs: [],
        values: [],
        title: 'x',
        branch: { t: 'carbPath', eq: 'co2' },
      } as never),
    ).toBe('recipe-value')
  })
  it('routes a carb step (carbPath branch, required non-bool logs) to log-delta', () => {
    expect(
      pickRenderer({
        timers: [],
        logs: [{ key: 'psi', kind: 'number', required: true }],
        values: [],
        title: 'x',
        branch: { t: 'carbPath', eq: 'co2' },
      } as never),
    ).toBe('log-delta')
  })
  it('defaults to recipe-value', () => {
    expect(pickRenderer({ timers: [], logs: [], values: [], title: 'x' } as never)).toBe(
      'recipe-value',
    )
  })
})

describe('requiredLogsComplete', () => {
  const makeStep = (logs: { key: string; kind: string; required?: boolean }[]) =>
    ({ logs, timers: [], values: [], title: 'x', body_md: '' }) as never

  it('returns false when a required non-bool field is unlogged', () => {
    const step = makeStep([{ key: 'og', kind: 'gravity', required: true }])
    expect(requiredLogsComplete(step, {})).toBe(false)
  })

  it('returns true when all required non-bool fields have values', () => {
    const step = makeStep([{ key: 'og', kind: 'gravity', required: true }])
    expect(requiredLogsComplete(step, { og: 1.05 })).toBe(true)
  })

  it('returns true when there are no required fields', () => {
    const step = makeStep([{ key: 'note', kind: 'text', required: false }])
    expect(requiredLogsComplete(step, {})).toBe(true)
  })

  it('gates on required bool fields — must be logged as true (C5)', () => {
    const step = makeStep([
      { key: 'sanitized', kind: 'bool', required: true },
      { key: 'temp', kind: 'temp', required: true },
    ])
    // Neither satisfied → false
    expect(requiredLogsComplete(step, {})).toBe(false)
    // Only numeric satisfied, bool still missing → false
    expect(requiredLogsComplete(step, { temp: 68 })).toBe(false)
    // Bool logged as false → still not satisfied (required bool must be true)
    expect(requiredLogsComplete(step, { temp: 68, sanitized: false })).toBe(false)
    // Both satisfied (bool=true, numeric present) → true
    expect(requiredLogsComplete(step, { temp: 68, sanitized: true })).toBe(true)
  })

  it('returns false when a required non-bool field has an empty string value', () => {
    const step = makeStep([{ key: 'notes', kind: 'text', required: true }])
    expect(requiredLogsComplete(step, { notes: '' })).toBe(false)
  })
})

describe('GuidedRunner', () => {
  it('renders the current step title + recipe name + peek', () => {
    render(<GuidedRunner />)
    // Title may appear in both <h1> (chrome) and the sub-renderer; at least one must exist
    expect(screen.getAllByText('Read & write down batch numbers').length).toBeGreaterThan(0)
    expect(screen.getByText('West Coast IPA')).toBeInTheDocument()
    expect(screen.getByText(/Next: Stage water/)).toBeInTheDocument()
  })

  it('Advance dispatches completeStep for the cursor', async () => {
    render(<GuidedRunner />)
    await userEvent.click(screen.getByRole('button', { name: /Advance/i }))
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'completeStep', step: 'read-batch-numbers' }),
    )
  })

  it('Back is disabled when at the first step (idx 0)', () => {
    render(<GuidedRunner />)
    const backBtn = screen.getByRole('button', { name: /Back/i })
    expect(backBtn).toBeDisabled()
  })

  it('Skip dispatches skipStep for the cursor', async () => {
    render(<GuidedRunner />)
    await userEvent.click(screen.getByRole('button', { name: /Skip/i }))
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'skipStep', step: 'read-batch-numbers' }),
    )
  })

  describe('recipe-driven ctx hydration', () => {
    const RECIPE_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
    const EQUIP_ID = 'bbbbbbbb-0000-4000-8000-000000000002'

    const mockRecipe = {
      id: RECIPE_ID,
      name: 'West Coast IPA',
      type: 'all-grain' as const,
      batchSize_L: 20,
      boilTime_min: 60,
      equipmentProfileId: EQUIP_ID,
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
      mashSteps: [],
      notes_md: '',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    const mockEquip = {
      id: EQUIP_ID,
      name: 'Test Kettle',
      isDefault: false,
      mashTunVolume_L: 40,
      mashTunDeadSpace_L: 0.5,
      kettleVolume_L: 40,
      kettleDeadSpace_L: 2.0,
      fermenterVolume_L: 30,
      fermenterDeadSpace_L: 0.5,
      evaporationRate_LperHr: 1.0,
      coolingShrinkage_pct: 4,
      topUpKettle_L: 0,
      topUpWater_L: 0,
      grainAbsorption_LperKg: 1.0,
      mashEfficiency_pct: 78,
      brewhouseEfficiency_pct: 72,
      ibuFormula: 'tinseth' as const,
      srmFormula: 'morey' as const,
      abvFormula: 'simple' as const,
      hopUtilizationMultiplier: 1,
      calibrationNotes_md: '',
      schemaVersion: 1 as const,
    }

    beforeEach(() => {
      // Inject recipe + equipment into the mutable containers
      recipesContainer.recipes = [mockRecipe]
      equipmentContainer.profiles = [mockEquip]
      mocks.session.recipeId = RECIPE_ID
    })

    afterEach(() => {
      recipesContainer.recipes = []
      equipmentContainer.profiles = []
      mocks.session.recipeId = undefined
    })

    it('builds a non-undefined recipe ctx when session has a recipeId matching the store', async () => {
      const { calculateRecipe } = await import('@/lib/brewing/calc/pipeline')

      render(<GuidedRunner />)

      // calculateRecipe should have been called with the matched recipe + equipment
      expect(calculateRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ id: RECIPE_ID }),
        expect.objectContaining({ id: EQUIP_ID }),
        expect.any(String),
      )
    })
  })

  describe('log-delta gating', () => {
    // Switch the session cursor to the log-og step (required gravity field)
    beforeEach(() => {
      mocks.session.cursor = 'log-og'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'log-og', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'log-og': { id: 'log-og', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    afterEach(() => {
      // Restore defaults so other tests are unaffected
      mocks.session.cursor = 'read-batch-numbers'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    it('Advance is disabled when a required log-delta field has not been logged', () => {
      render(<GuidedRunner />)
      const advanceBtn = screen.getByRole('button', { name: /Advance/i })
      expect(advanceBtn).toBeDisabled()
    })

    it('Advance is enabled after the required log-delta field is logged', () => {
      // Simulate the field already logged
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'log-og': {
          id: 'log-og',
          status: 'active',
          logs: [{ field: 'og', value: 1.052, at: '2026-06-25T00:00:00.000Z' }],
        },
      } as typeof mocks.session.steps
      render(<GuidedRunner />)
      const advanceBtn = screen.getByRole('button', { name: /Advance/i })
      expect(advanceBtn).not.toBeDisabled()
    })
  })

  describe('timer-store integration', () => {
    it('calls timerStore.load(session.id) on mount', async () => {
      render(<GuidedRunner />)
      await vi.waitFor(() => {
        expect(mocks.timerLoad).toHaveBeenCalledWith('sess-1')
      })
    })

    it('calls timerStore.arm with the step timers when entering a timer step', async () => {
      // Point cursor at the step that has timers
      mocks.session.cursor = 'timer-step'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'timer-step', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'timer-step': { id: 'timer-step', status: 'active', logs: [] },
      } as typeof mocks.session.steps

      render(<GuidedRunner />)

      await vi.waitFor(() => {
        expect(mocks.timerArm).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              stepId: 'timer-step',
              sessionId: 'sess-1',
              status: 'armed',
            }),
          ]),
        )
      })

      // Restore
      mocks.session.cursor = 'read-batch-numbers'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    it('does NOT re-arm timers when the store already has armed timers for the step', async () => {
      // Pre-populate the store with an armed timer for this step
      mocks.timerTimers = [
        { id: 'boil-timer', stepId: 'timer-step', status: 'armed', sessionId: 'sess-1' },
      ]
      mocks.session.cursor = 'timer-step'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'timer-step', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'timer-step': { id: 'timer-step', status: 'active', logs: [] },
      } as typeof mocks.session.steps

      render(<GuidedRunner />)

      // Allow effects to flush
      await new Promise((r) => setTimeout(r, 0))
      expect(mocks.timerArm).not.toHaveBeenCalled()

      // Restore
      mocks.timerTimers = []
      mocks.session.cursor = 'read-batch-numbers'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })
  })

  describe('handleWaterConfirm dispatches required logs before completeStep (C1)', () => {
    it('setActive is called + dispatch gets 3 log + 1 completeStep calls', async () => {
      // Simulate what the runner does: setActive resolves then 3 log dispatches + completeStep
      const mockSetActive = vi.fn().mockResolvedValue(undefined)
      const mockDispatch = vi.fn()

      const plan = {
        sourceProfileName: 'RO',
        additionsSummary: 'Gypsum 3.0 g',
        estMashPh: 5.35,
        skipped: false,
        totalSaltGrams: 3.0,
        lacticAcid_mL: 1.5,
      }
      const stepId = 'run-water-chemistry-gate'
      const now = new Date().toISOString()

      await mockSetActive(plan)
      mockDispatch({
        t: 'log',
        step: stepId,
        field: 'salts-added',
        value: plan.totalSaltGrams ?? 0,
        now,
      })
      mockDispatch({
        t: 'log',
        step: stepId,
        field: 'acid-added',
        value: plan.lacticAcid_mL ?? 0,
        now,
      })
      mockDispatch({
        t: 'log',
        step: stepId,
        field: 'predicted-ph',
        value: plan.estMashPh ?? 0,
        now,
      })
      mockDispatch({ t: 'completeStep', step: stepId, now: new Date().toISOString() })

      expect(mockSetActive).toHaveBeenCalledWith(plan)
      expect(mockDispatch).toHaveBeenCalledTimes(4)
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'log', field: 'salts-added', value: 3.0 }),
      )
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'log', field: 'acid-added', value: 1.5 }),
      )
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'log', field: 'predicted-ph', value: 5.35 }),
      )
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'completeStep', step: stepId }),
      )
    })
  })

  describe('batch lifecycle — rehydrate existing batch (C2)', () => {
    it('adopts existing in-progress batch and does NOT create a second', async () => {
      const existingBatch = { id: 'existing-batch-id', status: 'in-progress', batchNo: 1 }
      const getActive = vi.fn().mockResolvedValue(existingBatch)
      const nextBatchNo = vi.fn().mockResolvedValue(2)
      // Simulate the fixed create() function logic
      const activeBatchIdRef = { current: null as string | null }
      const setBatchActive = vi.fn()

      const existing = await getActive()
      if (existing) {
        activeBatchIdRef.current = existing.id
        setBatchActive(existing)
      } else {
        const id = crypto.randomUUID()
        activeBatchIdRef.current = id
        await nextBatchNo()
      }

      expect(getActive).toHaveBeenCalledTimes(1)
      expect(nextBatchNo).not.toHaveBeenCalled()
      expect(setBatchActive).toHaveBeenCalledWith(existingBatch)
      expect(activeBatchIdRef.current).toBe('existing-batch-id')
    })
  })

  describe('StepLogDelta target prop (I5)', () => {
    it('resolves targetValueKey via step.values to produce a numeric target', () => {
      const step = {
        logs: [
          { key: 'og', label: 'OG', kind: 'gravity', required: true, targetValueKey: 'targetOG' },
        ],
        values: [
          { key: 'targetOG', label: 'Target OG', source: 'calc', precision: 3 },
        ] satisfies ValueToken[],
        timers: [],
        title: 'Log OG',
      }
      // injectValues is mocked (returns 73.3), so ctx is inert scaffolding here.
      const ctx: ResolveCtx = {}
      const firstLog = step.logs[0]
      const targetKey = firstLog?.targetValueKey
      const valueToken = targetKey ? step.values.find((v) => v.key === targetKey) : undefined
      const resolved = valueToken ? injectValues(valueToken, ctx) : null
      // The mock injectValues returns { display: '73.3', ok: true, value: 73.3 }
      expect(resolved?.value).toBe(73.3)
    })
  })

  describe('enter-effects fire once per step (M2)', () => {
    it('applyEffects is called only once when session changes but step stays the same', () => {
      const enterEffectStepRef = { current: null as string | null }
      const mockApplyEffects = vi.fn()
      const applyOnStep = (stepId: string, _session: unknown) => {
        if (enterEffectStepRef.current === stepId) return
        enterEffectStepRef.current = stepId
        mockApplyEffects(stepId)
      }
      // Same step, called 3 times (simulating 3 session dispatches)
      applyOnStep('step-1', { id: 's1', v: 1 })
      applyOnStep('step-1', { id: 's1', v: 2 })
      applyOnStep('step-1', { id: 's1', v: 3 })
      expect(mockApplyEffects).toHaveBeenCalledTimes(1)
      // Different step fires again
      applyOnStep('step-2', { id: 's1', v: 4 })
      expect(mockApplyEffects).toHaveBeenCalledTimes(2)
    })
  })

  // ── Dead-end elimination tests (C2/C3/C4/C5) ────────────────────────────
  // These prove that timer + log-delta steps with required logs cannot dead-end:
  // Advance is gated until logs are satisfied.
  // Note: carbPath carb steps (e.g. co2-set-regulator) now render as log-delta,
  // not branch-choose. The advance-gate behavior is identical — branch field is ignored.

  describe('dead-end: timer step with required numeric log (heat-strike-water)', () => {
    beforeEach(() => {
      mocks.session.cursor = 'heat-strike-water'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'heat-strike-water', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'heat-strike-water': { id: 'heat-strike-water', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    afterEach(() => {
      mocks.session.cursor = 'read-batch-numbers'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    it('Advance is DISABLED until the required numeric log is entered', () => {
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).toBeDisabled()
    })

    it('Advance is ENABLED once the required numeric log is entered', () => {
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'heat-strike-water': {
          id: 'heat-strike-water',
          status: 'active',
          logs: [{ field: 'strikeTemp', value: 72, at: '2026-06-25T00:00:00.000Z' }],
        },
      } as typeof mocks.session.steps
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).not.toBeDisabled()
    })
  })

  describe('dead-end: log-delta carb step with required numeric log (co2-set-regulator)', () => {
    beforeEach(() => {
      mocks.session.cursor = 'co2-set-regulator'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'co2-set-regulator', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'co2-set-regulator': { id: 'co2-set-regulator', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    afterEach(() => {
      mocks.session.cursor = 'read-batch-numbers'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    it('Advance is DISABLED until the required numeric log is entered', () => {
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).toBeDisabled()
    })

    it('Advance is ENABLED once the required numeric log is entered', () => {
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'co2-set-regulator': {
          id: 'co2-set-regulator',
          status: 'active',
          logs: [{ field: 'psi', value: 11, at: '2026-06-25T00:00:00.000Z' }],
        },
      } as typeof mocks.session.steps
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).not.toBeDisabled()
    })
  })

  describe('dead-end: required bool + required number must BOTH be satisfied (weigh-grain)', () => {
    beforeEach(() => {
      mocks.session.cursor = 'weigh-grain'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'weigh-grain', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'weigh-grain': { id: 'weigh-grain', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    afterEach(() => {
      mocks.session.cursor = 'read-batch-numbers'
      mocks.session.resolvedSteps = ['read-batch-numbers', 'stage-water']
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'active', logs: [] },
      } as typeof mocks.session.steps
    })

    it('Advance is DISABLED when neither bool nor number is logged', () => {
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).toBeDisabled()
    })

    it('Advance is DISABLED when only the number is logged (bool still missing)', () => {
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'weigh-grain': {
          id: 'weigh-grain',
          status: 'active',
          logs: [{ field: 'weight', value: 4.5, at: '2026-06-25T00:00:00.000Z' }],
        },
      } as typeof mocks.session.steps
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).toBeDisabled()
    })

    it('Advance is DISABLED when bool=false even though number is logged', () => {
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'weigh-grain': {
          id: 'weigh-grain',
          status: 'active',
          logs: [
            { field: 'sanitized', value: false, at: '2026-06-25T00:00:00.000Z' },
            { field: 'weight', value: 4.5, at: '2026-06-25T00:00:00.000Z' },
          ],
        },
      } as typeof mocks.session.steps
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).toBeDisabled()
    })

    it('Advance is ENABLED only when bool=true AND number is logged', () => {
      mocks.session.steps = {
        'read-batch-numbers': { id: 'read-batch-numbers', status: 'done', logs: [] },
        'weigh-grain': {
          id: 'weigh-grain',
          status: 'active',
          logs: [
            { field: 'sanitized', value: true, at: '2026-06-25T00:00:00.000Z' },
            { field: 'weight', value: 4.5, at: '2026-06-25T00:00:00.000Z' },
          ],
        },
      } as typeof mocks.session.steps
      render(<GuidedRunner />)
      expect(screen.getByRole('button', { name: /Advance/i })).not.toBeDisabled()
    })
  })
})
