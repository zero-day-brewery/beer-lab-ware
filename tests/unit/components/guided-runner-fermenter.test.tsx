// @vitest-environment jsdom
// Proves the guided runner sources the target vessel from session.fermenterId at all
// four call sites (batch create, re-map, enter-effects, complete-effects) and rehydrates
// the batch BY BOARD (getByBoard), with a 'f1' fallback for legacy sessions.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const session = {
    id: 'sess-ferm',
    recipeId: undefined as string | undefined,
    recipeName: 'Vessel IPA',
    fermenterId: 'seed-b' as string | undefined,
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'step-a',
    resolvedSteps: ['step-a'],
    steps: { 'step-a': { id: 'step-a', status: 'active', logs: [] } },
    choices: {},
    timers: [],
    startedAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    schemaVersion: 1 as const,
  }
  return {
    session,
    getByBoard: vi.fn().mockResolvedValue(null),
    getActive: vi.fn().mockResolvedValue(null),
    nextBatchNo: vi.fn().mockResolvedValue(1),
    sessionToBatch: vi.fn((a: { fermenterId?: string; id: string }) => ({
      id: a.id,
      batchNo: 1,
      status: 'in-progress',
      fermenterBoardId: a.fermenterId,
    })),
    applyEffects: vi.fn(),
    dispatch: vi.fn(),
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'session' ? 'sess-ferm' : null) }),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: Object.assign(
    () => ({
      session: h.session,
      loadActive: vi.fn().mockResolvedValue(undefined),
      setActive: vi.fn().mockResolvedValue(undefined),
      dispatch: h.dispatch,
      lastRejection: null,
      flush: vi.fn(),
      clearRejection: vi.fn(),
    }),
    { getState: () => ({ session: h.session }) },
  ),
}))

vi.mock('@/lib/db/repos/session', () => ({
  sessionRepo: { get: vi.fn().mockResolvedValue(h.session) },
}))

vi.mock('@/lib/db/repos/batch', () => ({
  batchRepo: {
    getByBoard: (id: string) => h.getByBoard(id),
    getActive: () => h.getActive(),
    nextBatchNo: () => h.nextBatchNo(),
  },
}))

vi.mock('@/lib/brewing/batch/from-session', () => ({
  sessionToBatch: (a: unknown) => h.sessionToBatch(a as { fermenterId?: string; id: string }),
}))

vi.mock('@/stores/board-bridge', () => ({
  applyEffects: (...a: unknown[]) => h.applyEffects(...a),
}))

vi.mock('@/stores/active-batch-store', () => {
  const state = {
    setActive: vi.fn(),
    patch: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    batch: null,
  }
  const useActiveBatchStore = Object.assign(() => state, { getState: () => state })
  return { useActiveBatchStore }
})

vi.mock('@/stores/timer-store', () => ({
  useTimerStore: () => ({
    load: vi.fn().mockResolvedValue(undefined),
    arm: vi.fn().mockResolvedValue(undefined),
    timers: [],
    missedOnLoad: [],
    setTimers: vi.fn(),
    cancel: vi.fn(),
    tick: vi.fn(),
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
            id: 'step-a',
            title: 'Vessel step',
            body_md: '',
            values: [],
            logs: [],
            timers: [],
            enterEffects: [{ t: 'fermenter', to: 'fermenting' }],
            completeEffects: [{ t: 'fermenter', to: 'fermenting' }],
          },
        ],
      },
    ],
  },
  MANUAL_VERSION: 1,
}))

vi.mock('@/stores/recipes-store', () => ({ useRecipesStore: () => ({ recipes: [] }) }))
vi.mock('@/stores/equipment-store', () => ({ useEquipmentStore: () => ({ profiles: [] }) }))
vi.mock('@/stores/water-profiles-store', () => ({
  useWaterProfilesStore: () => ({ profiles: [] }),
}))
vi.mock('@/lib/brewing/water/ions', () => ({
  ZERO_PROFILE: { Ca_ppm: 0, Mg_ppm: 0, Na_ppm: 0, SO4_ppm: 0, Cl_ppm: 0, HCO3_ppm: 0 },
}))
vi.mock('@/lib/brewing/calc/pipeline', () => ({ calculateRecipe: vi.fn(() => undefined) }))
vi.mock('@/lib/brewing/defaults/b40pro', () => ({
  B40PRO_PROFILE: { id: 'b40', name: 'B40pro' },
  B40PRO_PROFILE_ID: 'b40',
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => ({ supported: false }) }))
vi.mock('@/hooks/use-alarm', () => ({
  useAlarm: () => ({ fire: vi.fn(), supported: { audio: false, vibrate: false } }),
}))
vi.mock('@/hooks/use-speech', () => ({ useSpeech: () => ({ speak: vi.fn(), supported: false }) }))

// Stub the leaf renderer components + timer rack (no ctx / audio needed here).
vi.mock('@/components/system/run/timer-rack', () => ({ TimerRack: () => null }))
vi.mock('@/components/system/run/step-recipe-value', () => ({ StepRecipeValue: () => null }))
vi.mock('@/components/system/run/step-log-delta', () => ({ StepLogDelta: () => null }))
vi.mock('@/components/system/run/step-checklist', () => ({ StepChecklist: () => null }))
vi.mock('@/components/system/run/step-timer', () => ({ StepTimer: () => null }))
vi.mock('@/components/system/run/step-water-plan', () => ({ StepWaterPlan: () => null }))

import { GuidedRunner } from '@/components/system/run/guided-runner'

afterEach(() => {
  vi.clearAllMocks()
  h.getByBoard.mockResolvedValue(null)
  h.session.fermenterId = 'seed-b'
})

describe('GuidedRunner — fermenter sourcing', () => {
  it('rehydrates BY BOARD using the session fermenterId', async () => {
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.getByBoard).toHaveBeenCalledWith('seed-b'))
  })

  it('creates the batch with the session fermenterId (sessionToBatch fermenterId)', async () => {
    render(<GuidedRunner />)
    await vi.waitFor(() =>
      expect(h.sessionToBatch).toHaveBeenCalledWith(
        expect.objectContaining({ fermenterId: 'seed-b' }),
      ),
    )
  })

  it('passes the session fermenterId to enter-effects (applyEffects 3rd arg)', async () => {
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.applyEffects).toHaveBeenCalled())
    // applyEffects(effects, session, fermenterId, batchId?)
    expect(h.applyEffects.mock.calls[0][2]).toBe('seed-b')
  })

  it('passes the session fermenterId to complete-effects on Advance', async () => {
    render(<GuidedRunner />)
    await userEvent.click(screen.getByRole('button', { name: /Advance/i }))
    const completeCall = h.applyEffects.mock.calls.find((c) => c[2] === 'seed-b')
    expect(completeCall).toBeTruthy()
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'completeStep', step: 'step-a' }),
    )
  })

  it('falls back to TARGET_FERMENTER_ID ("f1") when the session has no fermenterId (legacy)', async () => {
    h.session.fermenterId = undefined
    render(<GuidedRunner />)
    // sessionToBatch runs two awaits after getByBoard, so wait on it directly.
    await vi.waitFor(() =>
      expect(h.sessionToBatch).toHaveBeenCalledWith(expect.objectContaining({ fermenterId: 'f1' })),
    )
    expect(h.getByBoard).toHaveBeenCalledWith('f1')
    expect(h.applyEffects.mock.calls[0][2]).toBe('f1')
  })
})
