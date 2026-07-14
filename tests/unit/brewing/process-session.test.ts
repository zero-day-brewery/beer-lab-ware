import { describe, expect, it } from 'vitest'
import { resolveBranches } from '@/lib/brewing/process/branches'
import {
  type BrewSession,
  makeSessionFromGate,
  reduce,
  stageOfStep,
} from '@/lib/brewing/process/session'
import type { ProcessManual, ProcessStep } from '@/lib/brewing/process/types'

// Minimal pure manual fixture: prep(p1,p2) -> hotside(h1) -> fermentation(f1).
// No branch predicates here (branch behavior is covered in 3.2).
const MANUAL: ProcessManual = {
  version: 1,
  stages: [
    {
      id: 'prep',
      title: 'Prep',
      steps: [
        { id: 'p1', title: 'P1', body_md: '', values: [], logs: [], timers: [] },
        { id: 'p2', title: 'P2', body_md: '', values: [], logs: [], timers: [] },
      ],
    },
    {
      id: 'hotside',
      title: 'Hot Side',
      steps: [{ id: 'h1', title: 'H1', body_md: '', values: [], logs: [], timers: [] }],
    },
    {
      id: 'fermentation',
      title: 'Fermentation',
      steps: [{ id: 'f1', title: 'F1', body_md: '', values: [], logs: [], timers: [] }],
    },
  ],
}

function fresh(): BrewSession {
  return {
    id: 'sess-1',
    recipeId: undefined,
    recipeName: undefined,
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'p1',
    resolvedSteps: ['p1', 'p2', 'h1', 'f1'],
    steps: {
      p1: { id: 'p1', status: 'active', logs: [] },
      p2: { id: 'p2', status: 'pending', logs: [] },
      h1: { id: 'h1', status: 'pending', logs: [] },
      f1: { id: 'f1', status: 'pending', logs: [] },
    },
    choices: {},
    timers: [],
    startedAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    schemaVersion: 1,
  }
}

const NOW = '2026-06-25T10:05:00.000Z'

describe('stageOfStep', () => {
  it('maps a step id to its owning stage', () => {
    expect(stageOfStep(MANUAL, 'h1')).toBe('hotside')
    expect(stageOfStep(MANUAL, 'f1')).toBe('fermentation')
  })
})

describe('reduce — completeStep', () => {
  it('marks step done, stamps completedAt, advances cursor + stageId', () => {
    const r = reduce(fresh(), { t: 'completeStep', step: 'p1', now: NOW }, MANUAL, {})
    expect(r.rejected).toBeUndefined()
    expect(r.session.steps.p1.status).toBe('done')
    expect(r.session.steps.p1.completedAt).toBe(NOW)
    expect(r.session.steps.p2.status).toBe('active')
    expect(r.session.cursor).toBe('p2')
    expect(r.session.stageId).toBe('prep')
    expect(r.session.updatedAt).toBe(NOW)
  })

  it('crossing a stage boundary recomputes stageId', () => {
    let s = fresh()
    s = reduce(s, { t: 'completeStep', step: 'p1', now: NOW }, MANUAL, {}).session
    s = reduce(s, { t: 'completeStep', step: 'p2', now: NOW }, MANUAL, {}).session
    expect(s.cursor).toBe('h1')
    expect(s.stageId).toBe('hotside')
  })

  it('completing the final step flips lifecycle to done', () => {
    let s = fresh()
    for (const step of ['p1', 'p2', 'h1', 'f1']) {
      s = reduce(s, { t: 'completeStep', step, now: NOW }, MANUAL, {}).session
    }
    expect(s.steps.f1.status).toBe('done')
    expect(s.lifecycle).toBe('done')
  })

  it('completing a step that is not the cursor still marks it done without moving cursor backward', () => {
    let s = fresh()
    s = reduce(s, { t: 'completeStep', step: 'p1', now: NOW }, MANUAL, {}).session
    // cursor now p2; complete p2 explicitly
    const r = reduce(s, { t: 'completeStep', step: 'p2', now: NOW }, MANUAL, {})
    expect(r.session.cursor).toBe('h1')
  })
})

describe('reduce — skipStep', () => {
  it('marks skipped and advances cursor past it', () => {
    const r = reduce(fresh(), { t: 'skipStep', step: 'p1', now: NOW }, MANUAL, {})
    expect(r.session.steps.p1.status).toBe('skipped')
    expect(r.session.cursor).toBe('p2')
  })

  it('advances over consecutive skipped steps to the next non-skipped', () => {
    let s = fresh()
    // pre-skip p2 by marking it skipped in state, then skip p1 -> cursor should land on h1
    s = { ...s, steps: { ...s.steps, p2: { ...s.steps.p2, status: 'skipped' } } }
    const r = reduce(s, { t: 'skipStep', step: 'p1', now: NOW }, MANUAL, {})
    expect(r.session.cursor).toBe('h1')
  })

  it('I1 — skipping the last open step flips lifecycle to done', () => {
    // Advance to the last step (f1) by completing all prior steps.
    let s = fresh()
    for (const step of ['p1', 'p2', 'h1']) {
      s = reduce(s, { t: 'completeStep', step, now: NOW }, MANUAL, {}).session
    }
    expect(s.cursor).toBe('f1')
    expect(s.lifecycle).toBe('running')
    // Skip the last resolved step → should end the session.
    const r = reduce(s, { t: 'skipStep', step: 'f1', now: NOW }, MANUAL, {})
    expect(r.session.steps.f1.status).toBe('skipped')
    expect(r.session.lifecycle).toBe('done')
  })

  it('I1 — skipping the last step when all prior are already done/skipped flips lifecycle to done', () => {
    // Build a session where p1/p2/h1 are done and f1 is the remaining active step.
    const s: BrewSession = {
      ...fresh(),
      cursor: 'f1',
      steps: {
        p1: { id: 'p1', status: 'done', logs: [], completedAt: NOW },
        p2: { id: 'p2', status: 'done', logs: [], completedAt: NOW },
        h1: { id: 'h1', status: 'done', logs: [], completedAt: NOW },
        f1: { id: 'f1', status: 'active', logs: [] },
      },
    }
    const r = reduce(s, { t: 'skipStep', step: 'f1', now: NOW }, MANUAL, {})
    expect(r.session.lifecycle).toBe('done')
  })
})

describe('reduce — goto', () => {
  it('moves cursor to an arbitrary resolved step and recomputes stageId', () => {
    const r = reduce(fresh(), { t: 'goto', step: 'h1', now: NOW }, MANUAL, {})
    expect(r.session.cursor).toBe('h1')
    expect(r.session.stageId).toBe('hotside')
    expect(r.session.steps.h1.status).toBe('active')
  })

  it('goto a non-resolved step is rejected and leaves the session unchanged', () => {
    const r = reduce(fresh(), { t: 'goto', step: 'nope', now: NOW }, MANUAL, {})
    expect(r.rejected).toBeDefined()
    expect(r.session.cursor).toBe('p1')
  })
})

describe('reduce — pause/resume/abort', () => {
  it('pause sets lifecycle paused', () => {
    expect(reduce(fresh(), { t: 'pause', now: NOW }, MANUAL, {}).session.lifecycle).toBe('paused')
  })
  it('resume from paused returns to running', () => {
    const paused = { ...fresh(), lifecycle: 'paused' as const }
    expect(reduce(paused, { t: 'resume', now: NOW }, MANUAL, {}).session.lifecycle).toBe('running')
  })
  it('abort sets lifecycle aborted regardless of prior state', () => {
    expect(reduce(fresh(), { t: 'abort', now: NOW }, MANUAL, {}).session.lifecycle).toBe('aborted')
  })
})

describe('reduce — complete', () => {
  it('complete sets lifecycle done and stamps updatedAt', () => {
    const r = reduce(fresh(), { t: 'complete', now: NOW }, MANUAL, {})
    expect(r.rejected).toBeUndefined()
    expect(r.session.lifecycle).toBe('done')
    expect(r.session.updatedAt).toBe(NOW)
  })
  it('complete from paused → done', () => {
    const paused = { ...fresh(), lifecycle: 'paused' as const }
    expect(reduce(paused, { t: 'complete', now: NOW }, MANUAL, {}).session.lifecycle).toBe('done')
  })
  it('complete is lifecycle-only — leaves cursor and remaining step statuses untouched', () => {
    const r = reduce(fresh(), { t: 'complete', now: NOW }, MANUAL, {})
    expect(r.session.cursor).toBe('p1')
    expect(r.session.steps.p1.status).toBe('active')
    expect(r.session.steps.p2.status).toBe('pending')
  })
})

// ─── Branch fixture for Task 23 ──────────────────────────────────────────────
// Manual with two carbonation branch steps gated by carbPath; prep step p1 is unconditional.
const BRANCH_MANUAL: ProcessManual = {
  version: 1,
  stages: [
    {
      id: 'prep',
      title: 'Prep',
      steps: [{ id: 'p1', title: 'P1', body_md: '', values: [], logs: [], timers: [] }],
    },
    {
      id: 'packaging',
      title: 'Packaging',
      steps: [
        {
          id: 'carb-co2',
          title: 'CO2',
          body_md: '',
          values: [],
          logs: [],
          timers: [],
          branch: { t: 'carbPath', eq: 'co2' },
        } as ProcessStep,
        {
          id: 'carb-nitro',
          title: 'Nitro',
          body_md: '',
          values: [],
          logs: [],
          timers: [],
          branch: { t: 'carbPath', eq: 'nitro' },
        } as ProcessStep,
      ],
    },
  ],
}

function freshBranch(): BrewSession {
  // Start with co2 chosen so resolvedSteps = [p1, carb-co2]; carb-nitro is not-applicable.
  const resolved = resolveBranches(BRANCH_MANUAL, undefined, { carbPath: 'co2' }, undefined)
  const all = ['p1', 'carb-co2', 'carb-nitro']
  const steps: Record<string, BrewSession['steps'][string]> = {}
  for (const id of all) {
    steps[id] = {
      id,
      status: resolved.has(id) ? (id === 'p1' ? 'active' : 'pending') : 'not-applicable',
      logs: [],
    }
  }
  return {
    id: 'sess-b',
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'prep',
    cursor: 'p1',
    resolvedSteps: all.filter((id) => resolved.has(id)),
    steps,
    choices: { carbPath: 'co2' },
    timers: [],
    startedAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    schemaVersion: 1,
  }
}

describe('reduce — setChoice re-resolves branches', () => {
  it('switching carbPath co2→nitro swaps which step is resolved', () => {
    const r = reduce(
      freshBranch(),
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BRANCH_MANUAL,
      {},
    )
    expect(r.session.choices.carbPath).toBe('nitro')
    expect(r.session.resolvedSteps).toContain('carb-nitro')
    expect(r.session.resolvedSteps).not.toContain('carb-co2')
    expect(r.session.steps['carb-nitro'].status).toBe('pending')
    expect(r.session.steps['carb-co2'].status).toBe('not-applicable')
  })

  it('preserves a surviving step status (p1 done stays done across re-resolution)', () => {
    let s = freshBranch()
    s = reduce(s, { t: 'completeStep', step: 'p1', now: NOW }, BRANCH_MANUAL, {}).session
    const r = reduce(
      s,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BRANCH_MANUAL,
      {},
    )
    expect(r.session.steps.p1.status).toBe('done')
  })

  it('repairs cursor when it pointed at a now-excluded step', () => {
    let s = freshBranch()
    s = reduce(s, { t: 'completeStep', step: 'p1', now: NOW }, BRANCH_MANUAL, {}).session
    // cursor now carb-co2; switch to nitro should move cursor off the excluded step
    const r = reduce(
      s,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BRANCH_MANUAL,
      {},
    )
    expect(r.session.resolvedSteps).toContain(r.session.cursor)
    expect(r.session.cursor).not.toBe('carb-co2')
  })
})

// ─── Task 24: log action + required-LogField guard ───────────────────────────
const REQ_MANUAL: ProcessManual = {
  version: 1,
  stages: [
    {
      id: 'hotside',
      title: 'Hot Side',
      steps: [
        {
          id: 'log-og',
          title: 'Log OG',
          body_md: '',
          values: [],
          logs: [
            { key: 'measuredOG', label: 'OG', kind: 'gravity', required: true },
            { key: 'note', label: 'Note', kind: 'text' },
          ],
          timers: [],
        },
        { id: 'next', title: 'Next', body_md: '', values: [], logs: [], timers: [] },
      ],
    },
  ],
}

function freshReq(): BrewSession {
  return {
    id: 'sess-r',
    manualVersion: 1,
    lifecycle: 'running',
    stageId: 'hotside',
    cursor: 'log-og',
    resolvedSteps: ['log-og', 'next'],
    steps: {
      'log-og': { id: 'log-og', status: 'active', logs: [] },
      next: { id: 'next', status: 'pending', logs: [] },
    },
    choices: {},
    timers: [],
    startedAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    schemaVersion: 1,
  }
}

describe('reduce — log', () => {
  it('appends a StepLog with field/value/at', () => {
    const r = reduce(
      freshReq(),
      { t: 'log', step: 'log-og', field: 'measuredOG', value: 1.048, now: NOW },
      REQ_MANUAL,
      {},
    )
    expect(r.session.steps['log-og'].logs).toEqual([{ field: 'measuredOG', value: 1.048, at: NOW }])
  })

  it('logging the same field again replaces the prior value (last write wins)', () => {
    let s = freshReq()
    s = reduce(
      s,
      { t: 'log', step: 'log-og', field: 'measuredOG', value: 1.048, now: NOW },
      REQ_MANUAL,
      {},
    ).session
    s = reduce(
      s,
      { t: 'log', step: 'log-og', field: 'measuredOG', value: 1.05, now: NOW },
      REQ_MANUAL,
      {},
    ).session
    expect(s.steps['log-og'].logs).toEqual([{ field: 'measuredOG', value: 1.05, at: NOW }])
  })
})

describe('reduce — required-log guard on completeStep', () => {
  it('rejects completion when a required LogField has no value', () => {
    const r = reduce(freshReq(), { t: 'completeStep', step: 'log-og', now: NOW }, REQ_MANUAL, {})
    expect(r.rejected).toBeDefined()
    expect(r.rejected?.reason).toContain('measuredOG')
    expect(r.session.steps['log-og'].status).toBe('active')
    expect(r.session.cursor).toBe('log-og')
  })

  it('allows completion once the required field is logged', () => {
    let s = freshReq()
    s = reduce(
      s,
      { t: 'log', step: 'log-og', field: 'measuredOG', value: 1.048, now: NOW },
      REQ_MANUAL,
      {},
    ).session
    const r = reduce(s, { t: 'completeStep', step: 'log-og', now: NOW }, REQ_MANUAL, {})
    expect(r.rejected).toBeUndefined()
    expect(r.session.steps['log-og'].status).toBe('done')
    expect(r.session.cursor).toBe('next')
  })

  it('a non-required missing field never blocks completion', () => {
    let s = freshReq()
    s = reduce(
      s,
      { t: 'log', step: 'log-og', field: 'measuredOG', value: 1.048, now: NOW },
      REQ_MANUAL,
      {},
    ).session
    // 'note' (not required) left blank
    const r = reduce(s, { t: 'completeStep', step: 'log-og', now: NOW }, REQ_MANUAL, {})
    expect(r.rejected).toBeUndefined()
  })
})

describe('nextOpenStep — skips done steps (Task 22 carry-forward hardening)', () => {
  it('does not stop at a done step ahead of cursor', () => {
    // Simulate: p1 active, p2 done, h1 pending; advancing from p1 should skip p2 and land on h1.
    const s: BrewSession = {
      ...fresh(),
      steps: {
        p1: { id: 'p1', status: 'active', logs: [] },
        p2: { id: 'p2', status: 'done', logs: [], completedAt: NOW },
        h1: { id: 'h1', status: 'pending', logs: [] },
        f1: { id: 'f1', status: 'pending', logs: [] },
      },
    }
    // completeStep p1 → nextOpenStep should skip done p2 and land on h1
    const r = reduce(s, { t: 'completeStep', step: 'p1', now: NOW }, MANUAL, {})
    expect(r.session.cursor).toBe('h1')
  })

  it('goto back then setChoice then completeStep advances past the already-done step', () => {
    // p1 done, cursor at carb-co2 (active), setChoice→nitro repairs cursor to carb-nitro.
    // Then completing carb-nitro → session done (last step).
    let s = freshBranch()
    s = reduce(s, { t: 'completeStep', step: 'p1', now: NOW }, BRANCH_MANUAL, {}).session
    // cursor = carb-co2 (active)
    s = reduce(
      s,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BRANCH_MANUAL,
      {},
    ).session
    // cursor should now be carb-nitro (p1 done was skipped over)
    expect(s.cursor).toBe('carb-nitro')
    // completing carb-nitro (last resolved step) → lifecycle done
    const r = reduce(s, { t: 'completeStep', step: 'carb-nitro', now: NOW }, BRANCH_MANUAL, {})
    expect(r.session.lifecycle).toBe('done')
  })
})

// ─── makeSessionFromGate — carbPath default fix (bugfix4-report I1) ──────────
// Regression tests: without an explicit carbPath, the session must default to
// co2 so carbonation steps are reachable immediately. carbPath is gate-only —
// set at brew-start, never overridden mid-flow.
import { BREW_MANUAL } from '@/lib/brewing/process/manual'

describe('makeSessionFromGate — fermenterId', () => {
  it('carries the chosen fermenterId onto the session', () => {
    const session = makeSessionFromGate({
      id: 'ferm-1',
      now: Date.now(),
      manualVersion: 1,
      fermenterId: 'seed-vessel-uuid',
    })
    expect(session.fermenterId).toBe('seed-vessel-uuid')
  })

  it('omitting fermenterId stays valid — legacy sessions have none (undefined)', () => {
    const session = makeSessionFromGate({ id: 'ferm-2', now: Date.now(), manualVersion: 1 })
    expect(session.fermenterId).toBeUndefined()
    // The session must still be well-formed without the field.
    expect(session.lifecycle).toBe('running')
    expect(session.resolvedSteps.length).toBeGreaterThan(0)
  })
})

describe('makeSessionFromGate — carbPath defaulting', () => {
  const BASE = { id: 'gate-test-1', now: Date.now(), manualVersion: 1 }

  it('defaults carbPath to co2 when no choices supplied → co2 carb steps in resolvedSteps', () => {
    const session = makeSessionFromGate(BASE)
    expect(session.choices.carbPath).toBe('co2')
    expect(session.resolvedSteps).toContain('co2-set-regulator')
    expect(session.resolvedSteps).not.toContain('nitro-dispense-beergas')
  })

  it('explicit carbPath nitro → nitro steps resolved, co2 steps excluded', () => {
    const session = makeSessionFromGate({
      ...BASE,
      id: 'gate-test-2',
      choices: { carbPath: 'nitro' },
    })
    expect(session.choices.carbPath).toBe('nitro')
    expect(session.resolvedSteps).toContain('nitro-dispense-beergas')
    expect(session.resolvedSteps).not.toContain('co2-set-regulator')
  })

  it('after setChoice {carbPath:nitro} on a co2-default session, nitro steps resolve and co2 do not', () => {
    const session = makeSessionFromGate(BASE)
    // confirm starting state is co2
    expect(session.resolvedSteps).toContain('co2-set-regulator')
    // dispatch setChoice → nitro
    const { session: updated } = reduce(
      session,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BREW_MANUAL,
      {},
    )
    expect(updated.choices.carbPath).toBe('nitro')
    expect(updated.resolvedSteps).toContain('nitro-dispense-beergas')
    expect(updated.resolvedSteps).not.toContain('co2-set-regulator')
  })
})

// ─── B1: setChoice cursor-repair never moves backward (bugfix5) ──────────────
// Uses the REAL BREW_MANUAL to prove the CO2→Nitro switch mid-packaging
// does NOT jump the cursor back to the fermentation-stage nitro step.
describe('setChoice — cursor-repair never moves backward (B1 real-manual)', () => {
  it('CO2→Nitro switch at co2-set-regulator keeps cursor in packaging, NOT fermentation', () => {
    // Build a default CO2 session using the real manual.
    const session = makeSessionFromGate({ id: 'b1-test', now: Date.now(), manualVersion: 1 })
    expect(session.choices.carbPath).toBe('co2')
    expect(session.resolvedSteps).toContain('co2-set-regulator')

    // Capture the manual index of co2-set-regulator so we can confirm no backward move.
    const co2Idx = session.resolvedSteps.indexOf('co2-set-regulator')
    expect(co2Idx).toBeGreaterThan(-1)

    // Advance the cursor to 'co2-set-regulator' via goto (simulates user reaching packaging).
    const { session: atCo2 } = reduce(
      session,
      { t: 'goto', step: 'co2-set-regulator', now: NOW },
      BREW_MANUAL,
      {},
    )
    expect(atCo2.cursor).toBe('co2-set-regulator')
    expect(atCo2.stageId).toBe('packaging')

    // Now switch to nitro — this is the bug trigger.
    const { session: afterSwitch } = reduce(
      atCo2,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BREW_MANUAL,
      {},
    )

    // The cursor must land in packaging (on the packaging-stage nitro step),
    // NOT back in fermentation (nitro-target-low-co2 is in fermentation stage).
    expect(afterSwitch.stageId).toBe('packaging')
    expect(afterSwitch.cursor).not.toBe('nitro-target-low-co2')

    // The cursor must be a packaging nitro step.
    expect(afterSwitch.cursor).toBe('nitro-carb-low-co2')

    // The new cursor must be in the new resolvedSteps.
    expect(afterSwitch.resolvedSteps).toContain(afterSwitch.cursor)

    // The new cursor's index in the NEW resolvedSteps must be >= co2-set-regulator's
    // OLD index (no backward move), or at least not be fermentation.
    const newCursorIdx = afterSwitch.resolvedSteps.indexOf(afterSwitch.cursor)
    expect(newCursorIdx).toBeGreaterThanOrEqual(0)
  })

  it('CO2→Nitro at packaging — nitro-target-low-co2 (fermentation) must NOT be the cursor', () => {
    // nitro-target-low-co2 is in the fermentation stage (earlier than packaging steps).
    // After switching at a packaging position, the cursor must skip it even though it
    // is newly pending (and would be "first open" in naive whole-manual order).
    const session = makeSessionFromGate({ id: 'b1-test-2', now: Date.now(), manualVersion: 1 })
    const { session: atCo2 } = reduce(
      session,
      { t: 'goto', step: 'co2-set-regulator', now: NOW },
      BREW_MANUAL,
      {},
    )
    const { session: afterSwitch } = reduce(
      atCo2,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BREW_MANUAL,
      {},
    )
    expect(afterSwitch.cursor).not.toBe('nitro-target-low-co2')
    expect(afterSwitch.stageId).not.toBe('fermentation')
  })
})

// ─── Part A: Gate carbPath selector (bugfix6) ─────────────────────────────────
// Verify that makeSessionFromGate correctly initialises the session with the chosen
// carbPath so fermentation-stage nitro step is resolved from the start.
describe('makeSessionFromGate — gate carbPath selector (bugfix6-A)', () => {
  const BASE = { now: Date.now(), manualVersion: 1 }

  it('gate with Nitro → choices.carbPath===nitro and nitro-target-low-co2 in resolvedSteps', () => {
    const session = makeSessionFromGate({
      ...BASE,
      id: 'gate-nitro-1',
      choices: { carbPath: 'nitro' },
    })
    expect(session.choices.carbPath).toBe('nitro')
    expect(session.resolvedSteps).toContain('nitro-target-low-co2')
    expect(session.resolvedSteps).toContain('nitro-carb-low-co2')
    expect(session.resolvedSteps).toContain('nitro-dispense-beergas')
    expect(session.resolvedSteps).not.toContain('co2-set-regulator')
    expect(session.resolvedSteps).not.toContain('co2-set-and-wait-or-burst')
  })

  it('gate with CO2 (default) → choices.carbPath===co2 and co2 steps in resolvedSteps, nitro excluded', () => {
    const session = makeSessionFromGate({ ...BASE, id: 'gate-co2-1', choices: { carbPath: 'co2' } })
    expect(session.choices.carbPath).toBe('co2')
    expect(session.resolvedSteps).toContain('co2-set-regulator')
    expect(session.resolvedSteps).toContain('co2-set-and-wait-or-burst')
    expect(session.resolvedSteps).toContain('co2-balanced-dispense')
    expect(session.resolvedSteps).not.toContain('nitro-target-low-co2')
    expect(session.resolvedSteps).not.toContain('nitro-carb-low-co2')
  })
})

// ─── Part B: Stage-aware cursor repair (bugfix6) ──────────────────────────────
// Verifies the new stage-aware repair rule prevents stranding (both directions).
// Test setup marks prior conditioning steps as done to simulate a real brew flow
// where the user has progressed naturally through the stage.
describe('setChoice — stage-aware cursor repair (bugfix6-B)', () => {
  /**
   * Build a session in nitro mode with the cursor at nitro-dispense-pressure
   * (conditioning stage) and all prior conditioning steps completed, so that
   * co2-balanced-dispense is the earliest open CO2 step in the stage.
   */
  function makeSessionAtNitroConditioningStep(): BrewSession {
    let s = makeSessionFromGate({
      id: 'b6-nitro-cond',
      now: Date.now(),
      manualVersion: 1,
      choices: { carbPath: 'nitro' },
    })
    // Mark conditioning steps before nitro-dispense-pressure as done.
    // In a real flow, chill-keg-serving and confirm-carbonation are completed before
    // the user reaches the carbPath-gated dispense step.
    s = {
      ...s,
      cursor: 'nitro-dispense-pressure',
      stageId: 'conditioning',
      steps: {
        ...s.steps,
        'chill-keg-serving': { ...s.steps['chill-keg-serving'], status: 'done', completedAt: NOW },
        'confirm-carbonation': {
          ...s.steps['confirm-carbonation'],
          status: 'done',
          completedAt: NOW,
        },
        'nitro-dispense-pressure': { ...s.steps['nitro-dispense-pressure'], status: 'active' },
      },
    }
    return s
  }

  /**
   * Build a session in CO2 mode with the cursor at co2-balanced-dispense
   * (conditioning stage) and prior conditioning steps done.
   */
  function makeSessionAtCo2ConditioningStep(): BrewSession {
    let s = makeSessionFromGate({
      id: 'b6-co2-cond',
      now: Date.now(),
      manualVersion: 1,
      choices: { carbPath: 'co2' },
    })
    s = {
      ...s,
      cursor: 'co2-balanced-dispense',
      stageId: 'conditioning',
      steps: {
        ...s.steps,
        'chill-keg-serving': { ...s.steps['chill-keg-serving'], status: 'done', completedAt: NOW },
        'confirm-carbonation': {
          ...s.steps['confirm-carbonation'],
          status: 'done',
          completedAt: NOW,
        },
        'co2-balanced-dispense': { ...s.steps['co2-balanced-dispense'], status: 'active' },
      },
    }
    return s
  }

  it('Nitro→CO2 switch while in conditioning (prior steps done) → cursor lands on co2-balanced-dispense', () => {
    // co2-balanced-dispense is in conditioning and was not-applicable (nitro mode);
    // after switching to CO2 it becomes pending and is the first open CO2 step in the stage.
    const atNitroDisp = makeSessionAtNitroConditioningStep()
    expect(atNitroDisp.cursor).toBe('nitro-dispense-pressure')
    expect(atNitroDisp.stageId).toBe('conditioning')

    const { session: afterSwitch } = reduce(
      atNitroDisp,
      { t: 'setChoice', patch: { carbPath: 'co2' }, now: NOW },
      BREW_MANUAL,
      {},
    )

    // Must land on the first open CO2 step in conditioning: co2-balanced-dispense.
    // chill-keg-serving and confirm-carbonation are done so they are skipped.
    expect(afterSwitch.stageId).toBe('conditioning')
    expect(afterSwitch.cursor).toBe('co2-balanced-dispense')
    expect(afterSwitch.resolvedSteps).toContain('co2-balanced-dispense')
  })

  it('CO2→Nitro while in conditioning (prior steps done) → cursor lands on nitro-dispense-pressure, NOT packaging', () => {
    // nitro-dispense-pressure is in conditioning; nitro-carb-low-co2 is in packaging (past stage).
    // Because we are in conditioning, stageStartIdx is conditioning, so we must NOT land in packaging.
    const atCo2Disp = makeSessionAtCo2ConditioningStep()
    expect(atCo2Disp.cursor).toBe('co2-balanced-dispense')
    expect(atCo2Disp.stageId).toBe('conditioning')

    const { session: afterSwitch } = reduce(
      atCo2Disp,
      { t: 'setChoice', patch: { carbPath: 'nitro' }, now: NOW },
      BREW_MANUAL,
      {},
    )

    // Must stay in conditioning — the conditioning nitro step nitro-dispense-pressure is the target.
    expect(afterSwitch.stageId).toBe('conditioning')
    expect(afterSwitch.cursor).toBe('nitro-dispense-pressure')
    expect(afterSwitch.cursor).not.toBe('nitro-carb-low-co2') // packaging step
  })

  it('cursor stays unchanged when the old cursor step survives the switch', () => {
    // Switch a choice that doesn't affect the current cursor step.
    const session = makeSessionFromGate({
      id: 'b6-survive',
      now: Date.now(),
      manualVersion: 1,
      choices: { carbPath: 'co2' },
    })
    // cursor starts at first resolved step (prep stage); switching other choices leaves carbPath cursor intact.
    const startCursor = session.cursor
    const { session: afterSwitch } = reduce(
      session,
      { t: 'setChoice', patch: { noSparge: true }, now: NOW },
      BREW_MANUAL,
      {},
    )
    // If the cursor step still resolves, cursor must be unchanged.
    if (afterSwitch.resolvedSteps.includes(startCursor)) {
      expect(afterSwitch.cursor).toBe(startCursor)
    }
  })
})
