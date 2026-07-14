// @vitest-environment jsdom
// Proves the guided runner's mint effect deducts 1 unit from a pitched COUNTABLE
// (packet/vial) yeast lot exactly once per batch, and ONLY on the "new batch
// minted" path — never on the "existing batch rehydrated" path, regardless of
// the batch's `yeastDeducted` marker. Single-branch placement is what closes
// the TOCTOU double-deduct race (two mounts racing a shared board via
// `getByBoard`): a rehydrate never deducts, so there's nothing to race.
// Slurry (mL/g) is never auto-deducted, and a batch with no recorded lot is
// left alone.
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const session = {
    id: 'sess-yeast',
    recipeId: undefined as string | undefined,
    recipeName: 'Yeast IPA',
    fermenterId: 'f1' as string | undefined,
    yeastLotId: 'lot-1' as string | undefined,
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
    getLot: vi.fn(),
    consume: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'session' ? 'sess-yeast' : null) }),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: Object.assign(
    () => ({
      session: h.session,
      loadActive: vi.fn().mockResolvedValue(undefined),
      setActive: vi.fn().mockResolvedValue(undefined),
      dispatch: vi.fn(),
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

vi.mock('@/lib/db/repos/yeast-lots', () => ({
  yeastLotsRepo: {
    get: (id: string) => h.getLot(id),
    consume: (id: string, amount: number) => h.consume(id, amount),
  },
}))

// Mirrors the REAL sessionToBatch's yeast fields: yeastLotId is populated from
// the session; yeastDeducted is intentionally NEVER set by the mapper (the
// mapper is pure and re-runs on every mint + re-map — the marker only comes
// from the mint effect's own persisted write).
vi.mock('@/lib/brewing/batch/from-session', () => ({
  sessionToBatch: (a: { id: string; fermenterId?: string }) => ({
    id: a.id,
    batchNo: 1,
    status: 'in-progress',
    fermenterBoardId: a.fermenterId,
    yeastLotId: h.session.yeastLotId,
  }),
}))

vi.mock('@/stores/board-bridge', () => ({ applyEffects: vi.fn() }))

vi.mock('@/stores/active-batch-store', () => {
  const state = {
    setActive: vi.fn(),
    patch: (p: unknown) => h.patch(p),
    flush: () => h.flush(),
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
            title: 'Step',
            body_md: '',
            values: [],
            logs: [],
            timers: [],
            enterEffects: [],
            completeEffects: [],
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
  h.consume.mockResolvedValue(undefined)
  h.session.yeastLotId = 'lot-1'
})

describe('GuidedRunner — guarded yeast deduction', () => {
  it('deducts 1 unit from a countable (packet) lot on first mint and marks the batch', async () => {
    h.getLot.mockResolvedValue({ id: 'lot-1', unit: 'packet' })
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.consume).toHaveBeenCalledWith('lot-1', 1))
    expect(h.patch).toHaveBeenCalledWith({ yeastDeducted: true })
  })

  it('deducts a vial lot too', async () => {
    h.getLot.mockResolvedValue({ id: 'lot-1', unit: 'vial' })
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.consume).toHaveBeenCalledWith('lot-1', 1))
  })

  it('does NOT deduct a slurry (mL) lot — stays a manual Yeast Bank adjustment', async () => {
    h.getLot.mockResolvedValue({ id: 'lot-1', unit: 'mL' })
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.getLot).toHaveBeenCalled())
    expect(h.consume).not.toHaveBeenCalled()
    expect(h.patch).not.toHaveBeenCalledWith({ yeastDeducted: true })
  })

  it('does NOT deduct when no yeastLotId was recorded on the session/batch', async () => {
    h.session.yeastLotId = undefined
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.getByBoard).toHaveBeenCalled())
    expect(h.getLot).not.toHaveBeenCalled()
    expect(h.consume).not.toHaveBeenCalled()
  })

  it('does NOT re-deduct on remount when rehydrating an ALREADY-deducted batch (persistent marker, not a ref)', async () => {
    h.getByBoard.mockResolvedValue({
      id: 'batch-1',
      batchNo: 1,
      status: 'in-progress',
      yeastLotId: 'lot-1',
      yeastDeducted: true,
    })
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.getByBoard).toHaveBeenCalled())
    expect(h.getLot).not.toHaveBeenCalled()
    expect(h.consume).not.toHaveBeenCalled()
  })

  it('does NOT deduct on rehydrate even when the existing batch was never marked — deduction only fires on first mint, never on the rehydrate path (closes the TOCTOU double-deduct race between two mounts sharing a board)', async () => {
    h.getByBoard.mockResolvedValue({
      id: 'batch-1',
      batchNo: 1,
      status: 'in-progress',
      yeastLotId: 'lot-1',
      yeastDeducted: undefined,
    })
    h.getLot.mockResolvedValue({ id: 'lot-1', unit: 'packet' })
    render(<GuidedRunner />)
    await vi.waitFor(() => expect(h.getByBoard).toHaveBeenCalled())
    expect(h.getLot).not.toHaveBeenCalled()
    expect(h.consume).not.toHaveBeenCalled()
    expect(h.patch).not.toHaveBeenCalledWith({ yeastDeducted: true })
  })
})
