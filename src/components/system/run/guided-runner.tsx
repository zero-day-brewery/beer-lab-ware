'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DeductionReview } from '@/components/inventory/deduction-review'
import { useAlarm } from '@/hooks/use-alarm'
import { useSpeech } from '@/hooks/use-speech'
import { useWakeLock } from '@/hooks/use-wake-lock'
import { sessionToBatch } from '@/lib/brewing/batch/from-session'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { applyYeastDeduct } from '@/lib/brewing/inventory/yeast-deduct'
import { BREW_MANUAL } from '@/lib/brewing/process'
import { buildTimers } from '@/lib/brewing/process/timers'
import type { ProcessStep, StageId } from '@/lib/brewing/process/types'
import type { ResolveCtx } from '@/lib/brewing/process/values'
import type { Batch } from '@/lib/brewing/types/batch'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import { ZERO_PROFILE } from '@/lib/brewing/water/ions'
import { batchRepo } from '@/lib/db/repos/batch'
import { sessionRepo } from '@/lib/db/repos/session'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { useActiveBatchStore } from '@/stores/active-batch-store'
import { applyEffects } from '@/stores/board-bridge'
import { useEquipmentStore } from '@/stores/equipment-store'
import { useRecipesStore } from '@/stores/recipes-store'
import { useSessionStore } from '@/stores/session-store'
import { useTimerStore } from '@/stores/timer-store'
import { useWaterProfilesStore } from '@/stores/water-profiles-store'
import { abortBrew, completeBrew } from './session-controls'
import { StepChecklist } from './step-checklist'
import { StepLogDelta } from './step-log-delta'
import { StepRecipeValue } from './step-recipe-value'
import { StepTimer } from './step-timer'
import { StepWaterPlan, type StepWaterPlanWrite } from './step-water-plan'
import { TimerRack } from './timer-rack'

const STAGE_TITLE: Record<StageId, string> = {
  prep: 'Prep',
  hotside: 'Hot Side',
  fermentation: 'Fermentation',
  packaging: 'Packaging',
  conditioning: 'Conditioning',
}

// Legacy fallback vessel. The brew-start gate now captures the chosen fermenter as
// session.fermenterId, so the runner reads `session.fermenterId ?? TARGET_FERMENTER_ID`.
// The constant remains for sessions persisted before the picker existed (no fermenterId).
const TARGET_FERMENTER_ID = 'f1'

export type RendererKind = 'recipe-value' | 'timer' | 'log-delta' | 'checklist' | 'water-plan'

/**
 * Pure dispatch rule: maps a ProcessStep to the renderer kind.
 *
 * Priority order:
 * 0. step.id === 'run-water-chemistry-gate' → water-plan  (checked FIRST)
 * 1. has any timer → timer
 * 2. has required bool log(s) → checklist
 * 3. has required non-bool log → log-delta
 * 4. default → recipe-value
 *
 * Note: carbPath branching is gate-only (set at brew-start, never overridden mid-flow).
 * Carb steps carry branch.eq for filtering/resolvedSteps but route by their logs like
 * any other step — the branch field is intentionally ignored by pickRenderer.
 */
export function pickRenderer(step: ProcessStep): RendererKind {
  if (step.id === 'run-water-chemistry-gate') return 'water-plan'
  if (step.timers.length > 0) return 'timer'
  const requiredLogs = step.logs.filter((f) => f.required === true)
  if (requiredLogs.length > 0) {
    return requiredLogs.every((f) => f.kind === 'bool') ? 'checklist' : 'log-delta'
  }
  return 'recipe-value'
}

/**
 * Pure gate: returns true iff every required LogField has a satisfied value in `logged`.
 *
 * - bool fields: must be logged as `true` (a required checkbox must be ticked)
 * - all other fields: must have a non-empty, non-null value
 *
 * This function is the SINGLE gate for all renderer kinds (timer, log-delta,
 * checklist, recipe-value). The checklist renderer uses this too;
 * its bool fields now count toward Advance instead of being silently ignored.
 */
export function requiredLogsComplete(step: ProcessStep, logged: Record<string, unknown>): boolean {
  return step.logs
    .filter((f) => f.required === true)
    .every((f) => {
      const v = logged[f.key]
      if (f.kind === 'bool') {
        // Required bool must be explicitly true; false or absent → not satisfied
        return v === true
      }
      return v !== undefined && v !== null && v !== ''
    })
}

function findStep(id: string): { step: ProcessStep; stageId: StageId } | null {
  for (const stage of BREW_MANUAL.stages) {
    const step = stage.steps.find((s) => s.id === id)
    if (step) return { step, stageId: stage.id }
  }
  return null
}

export function GuidedRunner(): React.JSX.Element {
  const params = useSearchParams()
  const router = useRouter()
  const sessionId = params.get('session')
  const {
    session,
    loadActive,
    setActive,
    dispatch,
    lastRejection,
    clearRejection,
    pause,
    resume,
    complete,
    clear: clearSession,
    flush: flushSession,
  } = useSessionStore()

  // Timer store — persistent across reloads
  const { load: loadTimers, arm: armTimers, timers: persistedTimers } = useTimerStore()

  // Hydrate recipe / equipment / calc context
  const { recipes } = useRecipesStore()
  const { profiles: equipmentProfiles } = useEquipmentStore()
  const { profiles: waterProfiles } = useWaterProfilesStore()

  const recipe = session?.recipeId ? recipes.find((r) => r.id === session.recipeId) : undefined

  const equipment = recipe
    ? (equipmentProfiles.find((p) => p.id === recipe.equipmentProfileId) ?? B40PRO_PROFILE)
    : undefined

  const nowIso = new Date().toISOString()
  // biome-ignore lint/correctness/useExhaustiveDependencies: nowIso intentionally excluded — recompute only when recipe/equipment change
  const calc = useMemo(() => {
    if (!recipe || !equipment) return undefined
    return calculateRecipe(recipe, equipment, nowIso)
  }, [recipe, equipment])

  // Resolve source water profile for the water-plan step.
  // Prefer the profile named in session.water.sourceProfileName; fall back to
  // the first profile in the store; ultimate fallback is RO/distilled (ZERO_PROFILE).
  const waterSourceProfile = useMemo(() => {
    const named = session?.water?.sourceProfileName
    if (named) {
      const found = waterProfiles.find((p) => p.name === named)
      if (found) return found
    }
    return waterProfiles[0] ?? null
  }, [session?.water?.sourceProfileName, waterProfiles])

  const waterSourceIons = waterSourceProfile ?? ZERO_PROFILE
  const waterSourceName = waterSourceProfile?.name ?? 'RO / Distilled'
  const waterEquipment = equipment ?? B40PRO_PROFILE

  // Load the session identified by ?session=<uuid>.
  // Real session-store API: loadActive() + setActive(). No hydrate() method exists.
  // Strategy: call loadActive() first; if it resolves to the wrong session, fetch
  // from the repo by explicit ID and call setActive() to promote it.
  useEffect(() => {
    if (!sessionId) return
    const load = async () => {
      if (session?.id === sessionId) return
      await loadActive()
      const current = useSessionStore.getState().session
      if (current?.id !== sessionId) {
        const fetched = await sessionRepo.get(sessionId)
        if (fetched) await setActive(fetched)
      }
    }
    void load()
  }, [sessionId, session?.id, loadActive, setActive])

  // ── Timer-store hydration ─────────────────────────────────────────────────
  // Load persisted timers once when the session becomes known. Guard ref prevents
  // re-loading on every render while session.id is stable.
  const timerLoadedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!session?.id) return
    if (timerLoadedRef.current === session.id) return
    timerLoadedRef.current = session.id
    void loadTimers(session.id)
  }, [session?.id, loadTimers])

  // Arm timers when entering a timer step — once per step visit.
  // armedStepRef tracks which step IDs have already been armed this session.
  const armedStepRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!session?.id || !session.cursor) return
    const found = findStep(session.cursor)
    if (!found) return
    const { step } = found
    if (step.timers.length === 0) return
    if (armedStepRef.current.has(step.id)) return
    // Also skip if this step's timers are already in the store (survived reload).
    const alreadyArmed = persistedTimers.some((t) => t.stepId === step.id && t.status === 'armed')
    if (alreadyArmed) {
      armedStepRef.current.add(step.id)
      return
    }
    armedStepRef.current.add(step.id)
    const now = new Date().toISOString()
    const instances = buildTimers(step.id, step.timers, { recipe, now })
    const brewTimers: BrewTimer[] = instances.map((inst) => ({
      id: inst.id,
      sessionId: session.id,
      stepId: inst.stepId,
      label: inst.label,
      durationMin: inst.durationMin,
      fireAt: inst.fireAt,
      status: 'armed',
      isBoilMaster: inst.isBoilMaster,
      parentId: inst.parentId,
    }))
    void armTimers(brewTimers)
  }, [session?.id, session?.cursor, persistedTimers, armTimers, recipe])

  // ── Batch lifecycle wiring ────────────────────────────────────────────────
  // activeBatchIdRef: stable ref so re-renders don't create duplicate batches.
  const activeBatchIdRef = useRef<string | null>(null)
  const {
    batch: activeBatch,
    setActive: setBatchActive,
    patch: patchBatch,
    flush: flushBatch,
    clear: clearBatch,
  } = useActiveBatchStore()

  // "Deduct ingredients from inventory" review — opened from the runner once the
  // batch exists. The SAME shared component the Logbook uses; per-batch guard
  // dedupes across both entry points.
  const [showDeduct, setShowDeduct] = useState(false)

  // Effect 1: Create batch on first mount (once session is available).
  // biome-ignore lint/correctness/useExhaustiveDependencies: recipe/equipment/calc/manual are stable or change with session
  useEffect(() => {
    if (!session) return
    if (activeBatchIdRef.current) return // already created

    // Guarded once-per-batch yeast deduction: decrement 1 unit from the pitched
    // lot for countable forms only (packet/vial — see yeast-deduct.ts for why
    // slurry is excluded). Deliberately wired into ONLY the "new batch minted"
    // path below (never the "existing batch rehydrated" path): deduction is a
    // check-then-act (read yeastDeducted → consume → persist marker) with no
    // transaction spanning it, so calling it from BOTH branches opens a TOCTOU
    // double-deduct window — two mounts (e.g. two tabs/devices via the sync
    // server) can each `getByBoard` the same freshly-minted batch while the
    // marker is still false and both consume. Single-branch placement closes
    // that race: deduction fires once, at mint time, and a remount that
    // rehydrates an existing batch has nothing to race because it never calls
    // this at all. The decision itself lives in the pure shouldDeductYeast/
    // applyYeastDeduct helpers — this is orchestration only.
    const maybeDeductYeast = async (b: Batch): Promise<void> => {
      if (!b.yeastLotId || b.yeastDeducted) return
      const lot = await yeastLotsRepo.get(b.yeastLotId)
      const patch = await applyYeastDeduct(b, lot, (lotId, amount) =>
        yeastLotsRepo.consume(lotId, amount),
      )
      if (!patch) return
      patchBatch(patch)
      await useActiveBatchStore.getState().flush()
    }

    const create = async () => {
      // Rehydrate any existing in-progress batch ON THIS VESSEL before creating a new
      // one. Resolving by board (not the first-active batch) keeps concurrent brews on
      // different vessels attached to their own batch. This also prevents a duplicate
      // batch on every fresh mount (per-instance useRef is null on every navigation/
      // reload even when an in-progress batch already exists).
      const existing = await batchRepo.getByBoard(session.fermenterId ?? TARGET_FERMENTER_ID)
      if (existing) {
        activeBatchIdRef.current = existing.id
        setBatchActive(existing)
        // No deduct here — deliberately. Deduction only ever fires on the
        // "new batch minted" path below; a rehydrate is not a new pitch, so
        // there's nothing to deduct and nothing to race. (See the
        // maybeDeductYeast comment above for the TOCTOU rationale.) A crash
        // between mint and deduct leaves yeastDeducted false permanently —
        // accepted, and recoverable via a manual Yeast Bank per-lot edit.
        return
      }
      const id = crypto.randomUUID()
      activeBatchIdRef.current = id
      try {
        const batchNo = await batchRepo.nextBatchNo()
        const batch = sessionToBatch({
          session,
          recipe,
          equipment,
          calc,
          manual: BREW_MANUAL,
          id,
          batchNo,
          now: new Date().toISOString(),
          fermenterId: session.fermenterId ?? TARGET_FERMENTER_ID,
        })
        setBatchActive(batch)
        // Persist immediately so the logbook is visible right away
        await useActiveBatchStore.getState().flush()
        // The ONLY deduct call site — fires once, right after this batch's
        // first mint on this vessel (see maybeDeductYeast comment above).
        await maybeDeductYeast(batch)
      } catch (err) {
        console.error('[GuidedRunner] batch create failed:', err)
        toast.error('Failed to create brew log — check console for details.')
        // Reset the guard so a re-mount can retry
        activeBatchIdRef.current = null
      }
    }

    void create()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id])

  // Effect 2: Re-map batch when session state OR recipe/equipment/calc hydrate.
  // Including recipe/equipment/calc ensures that when Dexie liveQuery stores resolve
  // after navigation, the snapshot is captured into the existing batch (preserving id/batchNo).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — re-map when context changes
  useEffect(() => {
    if (!session || !activeBatchIdRef.current) return
    const batchId = activeBatchIdRef.current
    const existing = useActiveBatchStore.getState().batch ?? undefined
    const updated = sessionToBatch({
      session,
      recipe,
      equipment,
      calc,
      manual: BREW_MANUAL,
      id: batchId,
      batchNo: existing?.batchNo ?? 1,
      now: new Date().toISOString(),
      existing,
      fermenterId: session.fermenterId ?? TARGET_FERMENTER_ID,
    })
    patchBatch(updated)
  }, [session, recipe, equipment, calc])

  // Effect 3: Flush immediately when session completes (don't let debounce delay it).
  useEffect(() => {
    if (session?.lifecycle === 'done' && activeBatchIdRef.current) {
      void flushBatch()
    }
  }, [session?.lifecycle, flushBatch])

  // Surface dispatch rejections as toasts
  useEffect(() => {
    if (!lastRejection) return
    toast.error(lastRejection)
    clearRejection()
  }, [lastRejection, clearRejection])

  // Clear any stale rejection when the cursor moves to a new step.
  // session?.cursor is the intentional trigger; clearRejection is stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cursor change is the intended trigger
  useEffect(() => {
    clearRejection()
  }, [session?.cursor, clearRejection])

  const found = session ? findStep(session.cursor) : null
  const step = found?.step ?? null
  const kind = step ? pickRenderer(step) : 'recipe-value'
  const isHotSide = found?.stageId === 'hotside' || kind === 'timer'

  // Hook 1: Wake-lock — active on hot-side / timer steps
  useWakeLock(isHotSide)

  // Hook 2: Alarm — always wired; StepTimer uses it internally too
  useAlarm()

  // Hook 3: Speech — announce step title on step entry
  const { speak } = useSpeech(true)
  useEffect(() => {
    if (step) speak(step.title)
  }, [step, speak])

  // Board effects: project enterEffects when a new step becomes current.
  // Guard: only apply enter-effects when the step ID actually changes.
  // `session` is a new object on every dispatch, so including it in the dep array
  // would re-fire startSession on every log (resetting currentBrew.startedAt).
  const enterEffectStepRef = useRef<string | null>(null)
  useEffect(() => {
    if (!step || !session) return
    if (enterEffectStepRef.current === step.id) return
    enterEffectStepRef.current = step.id
    if (step.enterEffects && step.enterEffects.length > 0) {
      applyEffects(
        step.enterEffects,
        session,
        session.fermenterId ?? TARGET_FERMENTER_ID,
        activeBatchIdRef.current ?? undefined,
      )
    }
  }, [step, session])

  if (!session || !step) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">No active brew session.</p>
    )
  }

  const idx = session.resolvedSteps.indexOf(session.cursor)
  const total = session.resolvedSteps.length
  const pct = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0
  const nextId = session.resolvedSteps[idx + 1]
  const next = nextId ? findStep(nextId)?.step : undefined
  const stepState = session.steps[step.id]

  // Build logged map (field → value) — used for ALL renderer kinds.
  // Bool values land here too, which is what requiredLogsComplete now checks.
  const logged: Record<string, unknown> = {}
  for (const l of stepState?.logs ?? []) {
    logged[l.field] = l.value
  }

  // checked map is still needed by StepChecklist (bool field → boolean).
  const checked: Record<string, boolean> = {}
  for (const l of stepState?.logs ?? []) {
    if (typeof l.value === 'boolean') checked[l.field] = l.value
  }

  // Uniform advance gate: the same condition for every renderer kind.
  // requiredLogsComplete handles both bool (must be true) and non-bool (must be non-empty).
  const advanceOk = requiredLogsComplete(step, logged)

  const ctx: ResolveCtx = {
    recipe,
    equipment,
    calc,
    choices: session.choices,
    water: session.water
      ? {
          estMashPh: session.water.estMashPh,
          additionsSummary: session.water.additionsSummary,
        }
      : undefined,
  }
  const now = Date.now()

  const log = (field: string, value: string | number | boolean) =>
    dispatch({ t: 'log', step: step.id, field, value, now: new Date().toISOString() })

  const advance = () => {
    // Project completeEffects on advance
    if (step.completeEffects && step.completeEffects.length > 0) {
      applyEffects(
        step.completeEffects,
        session,
        session.fermenterId ?? TARGET_FERMENTER_ID,
        activeBatchIdRef.current ?? undefined,
      )
    }
    dispatch({ t: 'completeStep', step: step.id, now: new Date().toISOString() })
  }

  const skip = () => dispatch({ t: 'skipStep', step: step.id, now: new Date().toISOString() })

  // Water-plan step: record plan into session then advance/skip
  const handleWaterConfirm = (plan: StepWaterPlanWrite) => {
    void setActive({ ...session, water: plan }).then(() => {
      const now = new Date().toISOString()
      dispatch({
        t: 'log',
        step: step.id,
        field: 'salts-added',
        value: plan.totalSaltGrams ?? 0,
        now,
      })
      dispatch({
        t: 'log',
        step: step.id,
        field: 'acid-added',
        value: plan.lacticAcid_mL ?? 0,
        now,
      })
      dispatch({ t: 'log', step: step.id, field: 'predicted-ph', value: plan.estMashPh ?? 0, now })
      dispatch({ t: 'completeStep', step: step.id, now: new Date().toISOString() })
    })
  }
  const handleWaterSkip = (plan: StepWaterPlanWrite) => {
    void setActive({ ...session, water: plan }).then(() => {
      dispatch({ t: 'skipStep', step: step.id, now: new Date().toISOString() })
    })
  }

  const back = () => {
    const prev = session.resolvedSteps[idx - 1]
    if (prev) dispatch({ t: 'goto', step: prev, now: new Date().toISOString() })
  }

  // ── Session lifecycle controls ────────────────────────────────────────────
  const isPaused = session.lifecycle === 'paused'
  const togglePause = () => (isPaused ? resume() : pause())

  const onComplete = async () => {
    const { completed, batchId } = await completeBrew({
      session,
      activeBatch,
      recipe,
      equipment,
      calc,
      fermenterId: session.fermenterId ?? TARGET_FERMENTER_ID,
      now: new Date().toISOString(),
      batchRepo,
      complete,
      flushSession,
      clearSession,
      clearBatch,
      confirm: window.confirm.bind(window),
    })
    if (!completed) return
    activeBatchIdRef.current = null
    toast.success('Brew complete')
    router.push(batchId ? `/logbook/view/?id=${batchId}` : '/logbook')
  }

  const onAbort = async () => {
    const { aborted } = await abortBrew({
      activeBatch,
      now: new Date().toISOString(),
      batchRepo,
      abort: () => dispatch({ t: 'abort', now: new Date().toISOString() }),
      flushSession,
      clearSession,
      clearBatch,
      confirm: window.confirm.bind(window),
    })
    if (!aborted) return
    activeBatchIdRef.current = null
    toast('Brew aborted — batch archived')
    router.push('/system')
  }

  return (
    <div className="gs-screen">
      {/* Shared chrome: station pips + recipe name + exit */}
      <div className="gs-chrome">
        <div className="gs-pips">
          <span
            className={`gs-pip${found?.stageId === 'prep' || found?.stageId === 'hotside' ? ' on' : ''}`}
          >
            Brew
          </span>
          <span className="gs-pip">Chill</span>
          <span className={`gs-pip${found?.stageId === 'fermentation' ? ' on' : ''}`}>Ferment</span>
          <span
            className={`gs-pip${found?.stageId === 'packaging' || found?.stageId === 'conditioning' ? ' on' : ''}`}
          >
            Package
          </span>
        </div>
        <span className="gs-recipe">{session.recipeName ?? 'Brew session'}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost" onClick={togglePause}>
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void onComplete()}>
            ✓ Complete
          </button>
          <button type="button" className="btn-ghost danger" onClick={() => void onAbort()}>
            ⛔ Abort
          </button>
          <a className="gs-exit" href="/system">
            ✕ Exit
          </a>
        </div>
      </div>

      {/* Stage rail */}
      <div>
        <div className="gs-rail">
          <div className="gs-rail-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="gs-rail-meta">
          {STAGE_TITLE[found?.stageId ?? 'prep']} · step {idx + 1} / {total}
        </div>
      </div>

      {/* Inventory deduction — available once the batch exists (brew-start moment) */}
      {activeBatch && (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost" onClick={() => setShowDeduct(true)}>
            🍺 Deduct ingredients from inventory
          </button>
        </div>
      )}

      {/* Pinned safety banner. Most safety_md strings already begin with ⚠, so
          strip any leading warning glyph and render exactly one (avoids ⚠ ⚠). */}
      {step.safety_md && (
        <div className="gs-safety">⚠ {step.safety_md.replace(/^\s*⚠️?\s*/, '')}</div>
      )}

      {/* Hero step title */}
      <h1 className="gs-step-title">{step.title}</h1>

      {/* Persistent timer rack — ticks independently of the step renderer */}
      <TimerRack />

      {/* Renderer dispatch */}
      {kind === 'recipe-value' && <StepRecipeValue step={step} ctx={ctx} />}
      {kind === 'timer' &&
        (() => {
          // Include 'armed' AND 'fired' — exclude only 'cancelled'.
          // If we only match 'armed', a fired timer loses its fireAt and StepTimer
          // reverts to showing "Start timer" even though the timer already ran (I1).
          const stepTimer = persistedTimers.find(
            (t) => t.stepId === step.id && t.status !== 'cancelled',
          )
          return (
            <StepTimer
              step={step}
              ctx={ctx}
              now={now}
              fireAt={stepTimer?.fireAt}
              timerStatus={stepTimer?.status as 'armed' | 'fired' | undefined}
              recipeHops={recipe?.hops}
              boilMinutes={recipe?.boilTime_min}
              onStart={() => log('timerStarted', true)}
              logged={logged as Record<string, string | number | boolean>}
              onLog={(f, v) => log(f, v)}
            />
          )
        })()}
      {kind === 'log-delta' && (
        <StepLogDelta step={step} ctx={ctx} logged={logged} onChange={(f, v) => log(f, v)} />
      )}
      {kind === 'checklist' && (
        <StepChecklist step={step} ctx={ctx} checked={checked} onLog={(f, v) => log(f, v)} />
      )}
      {kind === 'water-plan' && (
        <StepWaterPlan
          recipe={recipe}
          equipment={waterEquipment}
          source={waterSourceIons}
          sourceName={waterSourceName}
          manualStyle="balanced"
          manualVolume_L={30}
          now={nowIso}
          onConfirm={handleWaterConfirm}
          onSkip={handleWaterSkip}
        />
      )}

      {/* Gated actions — hidden on water-plan (the step renders its own confirm/skip footer) */}
      {kind !== 'water-plan' && (
        <div className="gs-actions">
          <button type="button" className="gs-back" onClick={back} disabled={idx <= 0}>
            ◀ Back
          </button>
          <button type="button" className="gs-advance" onClick={advance} disabled={!advanceOk}>
            ✓ Advance
          </button>
          <button type="button" className="gs-skip" onClick={skip}>
            Skip ▶
          </button>
        </div>
      )}

      {/* Next-step peek */}
      {next && <p className="gs-peek">⌄ Next: {next.title}</p>}

      {showDeduct && activeBatch && (
        <DeductionReview batch={activeBatch} onClose={() => setShowDeduct(false)} />
      )}
    </div>
  )
}
