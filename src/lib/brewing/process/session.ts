/**
 * Guided Brew Flow — pure session state machine.
 * Lifecycle: idle → running → (paused ⇄ running) → done → archived, with aborted as escape.
 * PURE: no DOM, no Dexie, no fetch. Mirrors the calc-engine portability contract.
 */
import { resolveBranches } from '@/lib/brewing/process/branches'
import { BREW_MANUAL } from '@/lib/brewing/process/manual'
import type {
  LogField,
  ProcessManual,
  ProcessStep,
  StageId,
  StepId,
} from '@/lib/brewing/process/types'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Volumes } from '@/lib/brewing/types/results'

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'not-applicable'

export interface StepLog {
  field: string
  value: string | number | boolean
  at: string
}

export interface StepState {
  id: StepId
  status: StepStatus
  logs: StepLog[]
  completedAt?: string
}

export interface TimerState {
  id: string
  stepId: StepId
  label: string
  fireAt: string
  status: 'armed' | 'fired' | 'cancelled'
  firedAt?: string
}

export interface SessionChoices {
  carbPath?: 'co2' | 'nitro'
  noSparge?: boolean
  usesStarter?: boolean
  pressureFromPitch?: boolean
}

export interface SessionWaterPlan {
  sourceProfileName?: string
  additionsSummary?: string
  skipped?: boolean
  estMashPh?: number
}

export type SessionLifecycle = 'idle' | 'running' | 'paused' | 'done' | 'archived' | 'aborted'

export interface BrewSession {
  id: string
  recipeId?: string
  recipeName?: string
  /** The board vessel this brew fills, chosen in the brew-start gate. OPTIONAL:
   *  legacy sessions persisted before the fermenter picker have none, and the
   *  runner falls back to TARGET_FERMENTER_ID ('f1'). The session is the canonical
   *  source of this choice — it survives rehydration where refs/board state don't. */
  fermenterId?: string
  /** The yeast lot actually pitched (brew-start gate). Optional: a brew with no pick behaves as before. */
  yeastLotId?: string
  manualVersion: number
  lifecycle: SessionLifecycle
  stageId: StageId
  cursor: StepId
  resolvedSteps: StepId[]
  steps: Record<StepId, StepState>
  choices: SessionChoices
  water?: SessionWaterPlan
  timers: TimerState[]
  startedAt: string
  updatedAt: string
  schemaVersion: 1
}

export type SessionAction =
  | { t: 'log'; step: StepId; field: string; value: string | number | boolean; now: string }
  | { t: 'completeStep'; step: StepId; now: string }
  | { t: 'skipStep'; step: StepId; now: string }
  | { t: 'goto'; step: StepId; now: string }
  | { t: 'setChoice'; patch: Partial<SessionChoices>; now: string }
  | { t: 'pause'; now: string }
  | { t: 'resume'; now: string }
  | { t: 'complete'; now: string }
  | { t: 'abort'; now: string }

export interface ReduceResult {
  session: BrewSession
  rejected?: { reason: string }
}

/** Find the stage id that owns a step. Falls back to the session's current stage. */
export function stageOfStep(manual: ProcessManual, step: StepId): StageId | undefined {
  for (const stage of manual.stages) {
    if (stage.steps.some((s) => s.id === step)) return stage.id
  }
  return undefined
}

/** Lookup a ProcessStep definition by id (pure; used by the required-log guard in 3.3). */
function findStep(manual: ProcessManual, step: StepId): ProcessStep | undefined {
  for (const stage of manual.stages) {
    const found = stage.steps.find((s) => s.id === step)
    if (found) return found
  }
  return undefined
}

/** Next open (non-done, non-skipped, non-not-applicable) step after `from` within resolvedSteps; undefined if none. */
function nextOpenStep(s: BrewSession, from: StepId): StepId | undefined {
  const idx = s.resolvedSteps.indexOf(from)
  if (idx === -1) return undefined
  for (let i = idx + 1; i < s.resolvedSteps.length; i++) {
    const id = s.resolvedSteps[i]
    const st = s.steps[id]?.status
    if (st !== 'skipped' && st !== 'not-applicable' && st !== 'done') return id
  }
  return undefined
}

function isLastResolved(s: BrewSession, step: StepId): boolean {
  return nextOpenStep(s, step) === undefined
}

function touch(s: BrewSession, now: string): BrewSession {
  return { ...s, updatedAt: now }
}

export function reduce(
  s: BrewSession,
  a: SessionAction,
  manual: ProcessManual,
  ctx: { recipe?: Recipe; volumes?: Volumes },
): ReduceResult {
  switch (a.t) {
    case 'completeStep': {
      const def = findStep(manual, a.step)
      const stepLogs = s.steps[a.step].logs
      const missing = (def?.logs ?? []).find((f: LogField) => {
        if (!f.required) return false
        const entry = stepLogs.find((l) => l.field === f.key)
        if (!entry) return true // no log entry at all → missing
        // Required bool fields must be explicitly true; logged=false is not satisfied
        if (f.kind === 'bool') return entry.value !== true
        return false
      })
      if (missing) {
        return { session: s, rejected: { reason: `required field ${missing.key} is empty` } }
      }
      const next = nextOpenStep(s, a.step)
      const steps: Record<StepId, StepState> = {
        ...s.steps,
        [a.step]: { ...s.steps[a.step], status: 'done', completedAt: a.now },
      }
      if (next) steps[next] = { ...steps[next], status: 'active' }
      const last = isLastResolved(s, a.step)
      return {
        session: touch(
          {
            ...s,
            steps,
            cursor: next ?? s.cursor,
            stageId: next ? (stageOfStep(manual, next) ?? s.stageId) : s.stageId,
            lifecycle: last ? 'done' : s.lifecycle,
          },
          a.now,
        ),
      }
    }
    case 'skipStep': {
      const steps: Record<StepId, StepState> = {
        ...s.steps,
        [a.step]: { ...s.steps[a.step], status: 'skipped' },
      }
      const next = nextOpenStep({ ...s, steps }, a.step)
      if (next) steps[next] = { ...steps[next], status: 'active' }
      const last = isLastResolved({ ...s, steps }, a.step)
      return {
        session: touch(
          {
            ...s,
            steps,
            cursor: next ?? s.cursor,
            stageId: next ? (stageOfStep(manual, next) ?? s.stageId) : s.stageId,
            lifecycle: last ? 'done' : s.lifecycle,
          },
          a.now,
        ),
      }
    }
    case 'goto': {
      if (!s.resolvedSteps.includes(a.step)) {
        return { session: s, rejected: { reason: `unknown step ${a.step}` } }
      }
      const steps: Record<StepId, StepState> = {
        ...s.steps,
        [a.step]: {
          ...s.steps[a.step],
          status: s.steps[a.step].status === 'done' ? 'done' : 'active',
        },
      }
      return {
        session: touch(
          { ...s, steps, cursor: a.step, stageId: stageOfStep(manual, a.step) ?? s.stageId },
          a.now,
        ),
      }
    }
    case 'pause':
      return { session: touch({ ...s, lifecycle: 'paused' }, a.now) }
    case 'resume':
      return { session: touch({ ...s, lifecycle: 'running' }, a.now) }
    case 'complete':
      // Finalize the brew now: flip lifecycle to 'done' unconditionally (any
      // remaining steps are simply left where they are). Cleaner than faking a
      // last-step advance — the batch mapper reads lifecycle, not step cursor.
      return { session: touch({ ...s, lifecycle: 'done' }, a.now) }
    case 'abort':
      return { session: touch({ ...s, lifecycle: 'aborted' }, a.now) }
    case 'log': {
      const prev = s.steps[a.step]
      const logs: StepLog[] = [
        ...prev.logs.filter((l) => l.field !== a.field),
        { field: a.field, value: a.value, at: a.now },
      ]
      return {
        session: touch({ ...s, steps: { ...s.steps, [a.step]: { ...prev, logs } } }, a.now),
      }
    }
    case 'setChoice': {
      const choices: SessionChoices = { ...s.choices, ...a.patch }
      const resolved = resolveBranches(manual, ctx.recipe, choices, ctx.volumes)
      // Derive resolvedSteps in manual order so cursor/advance ordering is stable.
      const ordered: StepId[] = []
      for (const stage of manual.stages) {
        for (const step of stage.steps) {
          if (resolved.has(step.id)) ordered.push(step.id)
        }
      }
      // Rebuild step states: preserve status of surviving steps; newly-excluded → not-applicable.
      const steps: Record<StepId, StepState> = {}
      for (const stage of manual.stages) {
        for (const step of stage.steps) {
          const prev = s.steps[step.id]
          if (resolved.has(step.id)) {
            // Surviving or newly-included: keep prior status if it was applicable, else pending.
            const keep: StepStatus =
              prev && prev.status !== 'not-applicable' ? prev.status : 'pending'
            steps[step.id] = {
              id: step.id,
              status: keep,
              logs: prev?.logs ?? [],
              completedAt: prev?.completedAt,
            }
          } else {
            steps[step.id] = { id: step.id, status: 'not-applicable', logs: prev?.logs ?? [] }
          }
        }
      }
      // Repair cursor if it now points at an excluded step: snap to the first open step
      // within the CURRENT STAGE (or later), never to a step in a past stage.
      //
      // Stage-aware rule (bugfix6):
      //   Compute stageStartIdx = full-manual index of the FIRST step in the old cursor's stage.
      //   This is the floor — we never jump to a step in an earlier stage.
      //
      //   A step qualifies as a repair candidate if it is open AND:
      //     (a) its full-manual index >= oldCursorIdx  (at-or-after the old cursor, any stage), OR
      //     (b) its full-manual index >= stageStartIdx AND it is NEWLY-INCLUDED
      //         (was not-applicable before this setChoice, is now pending/active).
      //
      //   Condition (a) handles cases where no method-switch reversal is needed (steps forward).
      //   Condition (b) handles mid-flow method switches where the newly-chosen method's step
      //   inside the current stage lies BEFORE the old cursor in manual order:
      //     e.g. Nitro→CO2 in conditioning: co2-balanced-dispense (step 3) is newly-included
      //          and is in the same stage as nitro-dispense-pressure (step 4, old cursor).
      //          Using (b) picks co2-balanced-dispense without sliding back to already-passed
      //          unconditional pending steps (e.g. chill-keg-serving if not yet done).
      //   Condition (b) also ensures B1 is preserved: the CO2→Nitro packaging switch correctly
      //   picks nitro-carb-low-co2 (newly-included, same stage) rather than jumping back to
      //   nitro-target-low-co2 (fermentation, before stageStartIdx) or forward-stranding.
      //
      //   Preference order:
      //     1. First open step satisfying (a) or (b) in manual order.
      //     2. First open step anywhere in the new order (fallback if nothing in stage+).
      //     3. Last step in ordered (all done/skipped, session nearly complete).
      let cursor = s.cursor
      if (!resolved.has(cursor)) {
        // Build a lookup of FULL manual position (across all stages, all steps) for every step id.
        // Using the full manual rather than resolvedSteps means newly-included steps that were
        // previously not-applicable also get their correct position.
        const fullManualIdx: Map<StepId, number> = new Map()
        let pos = 0
        for (const stage of manual.stages) {
          for (const step of stage.steps) {
            fullManualIdx.set(step.id as StepId, pos++)
          }
        }

        // Old cursor's absolute manual index.
        const oldAbsIdx = fullManualIdx.get(s.cursor) ?? 0

        // Full-manual index of the first step in the old cursor's stage.
        // Steps before this index are in past stages — never jump there.
        const oldCursorStage = stageOfStep(manual, s.cursor)
        const stageFirstStepId = oldCursorStage
          ? (manual.stages.find((st) => st.id === oldCursorStage)?.steps[0]?.id as
              | StepId
              | undefined)
          : undefined
        const stageStartIdx =
          stageFirstStepId != null ? (fullManualIdx.get(stageFirstStepId) ?? 0) : 0

        const isOpen = (id: StepId): boolean => {
          const st = steps[id]?.status
          return st !== 'done' && st !== 'skipped' && st !== 'not-applicable'
        }

        // "Newly-included": was not-applicable in the old session, now open in the new state.
        const wasNotApplicable = (id: StepId): boolean => s.steps[id]?.status === 'not-applicable'

        // 1st preference: first open step satisfying (a) at-or-after old cursor, or
        //                 (b) newly-included and at-or-after stageStart.
        const stageAwareOpen = ordered.find((id) => {
          const absIdx = fullManualIdx.get(id) ?? Infinity
          if (!isOpen(id)) return false
          const atOrAfterCursor = absIdx >= oldAbsIdx // condition (a)
          const newlyInStage = absIdx >= stageStartIdx && wasNotApplicable(id) // condition (b)
          return atOrAfterCursor || newlyInStage
        })

        // 2nd preference: first open step anywhere in the new order (only if nothing qualifies above).
        const anyOpen = stageAwareOpen ?? ordered.find((id) => isOpen(id))

        // 3rd preference: last step in ordered (all done/skipped, session nearly complete).
        cursor = anyOpen ?? ordered[ordered.length - 1] ?? cursor
        if (steps[cursor] && steps[cursor].status !== 'done') {
          steps[cursor] = { ...steps[cursor], status: 'active' }
        }
      }
      return {
        session: touch(
          {
            ...s,
            choices,
            resolvedSteps: ordered,
            steps,
            cursor,
            stageId: stageOfStep(manual, cursor) ?? s.stageId,
          },
          a.now,
        ),
      }
    }
    default: {
      const _exhaustive: never = a
      return { session: s }
    }
  }
}

export type { LogField }

/**
 * Pure factory that seeds a new BrewSession from the gate's collected inputs.
 * Callers supply `id` (from newId()) and `now` (from Date.now()) so this
 * function remains deterministic and testable with no hidden I/O.
 *
 * @param input.id         - New session UUID, generated by caller
 * @param input.now        - Unix ms timestamp (Date.now()) for startedAt/updatedAt
 * @param input.recipeId   - Optional recipe id linked to this batch
 * @param input.recipeName - Optional recipe name for display
 * @param input.manualVersion - MANUAL_VERSION pinned at session creation time
 * @param input.water      - Water chemistry plan (or skipped flag)
 * @param input.recipe     - Full Recipe object used for branch resolution
 * @param input.volumes    - Computed volumes used for branch resolution
 * @param input.choices    - Initial SessionChoices (branch-driving flags)
 * @param input.yeastLotId - The yeast lot pitched (brew-start gate). Lives at
 *                           the session ROOT, never in `choices` — it must not
 *                           influence branch resolution.
 */
export function makeSessionFromGate(input: {
  id: string
  now: number
  recipeId?: string
  recipeName?: string
  fermenterId?: string
  yeastLotId?: string
  manualVersion: number
  water?: SessionWaterPlan
  recipe?: Recipe
  volumes?: Volumes
  choices?: SessionChoices
}): BrewSession {
  const {
    id,
    now,
    recipeId,
    recipeName,
    fermenterId,
    yeastLotId,
    manualVersion,
    water,
    recipe,
    volumes,
    choices: inputChoices,
  } = input

  const choices: SessionChoices = { carbPath: 'co2', ...inputChoices }
  const nowIso = new Date(now).toISOString()

  // Resolve which steps apply given the recipe/choices
  const resolved = resolveBranches(BREW_MANUAL, recipe, choices, volumes)

  // Build resolvedSteps in manual order (stable for cursor/advance ordering)
  const resolvedSteps: StepId[] = []
  for (const stage of BREW_MANUAL.stages) {
    for (const step of stage.steps) {
      if (resolved.has(step.id)) resolvedSteps.push(step.id)
    }
  }

  // Build per-step state — first resolved step starts active, rest pending
  const steps: Record<StepId, StepState> = {}
  for (const stage of BREW_MANUAL.stages) {
    for (const step of stage.steps) {
      steps[step.id] = {
        id: step.id,
        status: resolved.has(step.id) ? 'pending' : 'not-applicable',
        logs: [],
      }
    }
  }

  const cursor = resolvedSteps[0] ?? ('prep-read-batch-numbers' as StepId)
  if (steps[cursor]) {
    steps[cursor] = { ...steps[cursor], status: 'active' }
  }

  const firstStage: StageId =
    (BREW_MANUAL.stages.find((stage) => stage.steps.some((s) => s.id === cursor))?.id as StageId) ??
    'prep'

  return {
    id,
    recipeId,
    recipeName,
    fermenterId,
    ...(yeastLotId ? { yeastLotId } : {}),
    manualVersion,
    lifecycle: 'running',
    stageId: firstStage,
    cursor,
    resolvedSteps,
    steps,
    choices,
    water,
    timers: [],
    startedAt: nowIso,
    updatedAt: nowIso,
    schemaVersion: 1,
  }
}
