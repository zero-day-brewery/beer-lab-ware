/**
 * Pure mapper: BrewSession → Batch.
 * PURE: no Dexie, no DOM, no Date.now(), no crypto, no fetch.
 * All I/O is injected by the caller (id, batchNo, now, existing).
 */
import { apparentAttenuationPct, calcBrewhouseEfficiency } from '@/lib/brewing/batch/efficiency'
import { calcABV } from '@/lib/brewing/calc/abv'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { ProcessManual } from '@/lib/brewing/process/types'
import { injectValues } from '@/lib/brewing/process/values'
import type { Batch, BatchResults, LogEntry } from '@/lib/brewing/types/batch'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'

export function sessionToBatch(args: {
  session: BrewSession
  recipe?: Recipe
  equipment?: EquipmentProfile
  calc?: CalculationResult
  manual: ProcessManual
  id: string
  batchNo: number
  now: string
  existing?: Batch
  /** The board vessel this brew is fermenting in (currently the hard default
   *  'f1' from the guided runner). Recorded as `Batch.fermenterBoardId` so the
   *  batch knows which vessel it's linked to. Optional: a manual/legacy batch
   *  may have none, and a re-map without it preserves any existing value. */
  fermenterId?: string
}): Batch {
  const { session, recipe, equipment, calc, manual, id, batchNo, now, existing, fermenterId } = args

  // ── Snapshots ────────────────────────────────────────────────────────────────
  // Prefer the freshly-supplied value; fall back to whatever was previously captured;
  // omit (undefined) when neither is available — a manual brew with no recipe is valid.
  const recipeSnapshot: Recipe | undefined = recipe
    ? (structuredClone(recipe) as Recipe)
    : existing?.recipeSnapshot

  const equipmentSnapshot: EquipmentProfile | undefined = equipment
    ? (structuredClone(equipment) as EquipmentProfile)
    : existing?.equipmentSnapshot

  const computedTargets: CalculationResult | undefined = calc
    ? (structuredClone(calc) as CalculationResult)
    : existing?.computedTargets

  // ── Status ───────────────────────────────────────────────────────────────────
  let status: Batch['status']
  switch (session.lifecycle) {
    case 'running':
    case 'paused':
      status = 'in-progress'
      break
    case 'done':
      status = 'complete'
      break
    case 'archived':
    // An aborted brew keeps its partial record as an ARCHIVED batch (never left
    // 'in-progress'). This also fixes the re-attach bug: getByBoard/getActive
    // filter on 'in-progress', so an archived batch is no longer resurrected.
    case 'aborted':
      status = 'archived'
      break
    default:
      status = existing?.status ?? 'in-progress'
  }

  // ── completedAt ──────────────────────────────────────────────────────────────
  const completedAt: string | undefined =
    status === 'complete' ? (existing?.completedAt ?? now) : existing?.completedAt

  // ── archivedAt ───────────────────────────────────────────────────────────────
  // Stamp the archive time when the batch lands in 'archived' (abort path);
  // preserve any prior value on a re-map so the first archive time sticks.
  const archivedAt: string | undefined =
    status === 'archived' ? (existing?.archivedAt ?? now) : existing?.archivedAt

  // ── Logs: flatten all step logs → LogEntry[] ─────────────────────────────────
  // Build a lookup map: stepId → ProcessStep for O(1) access
  const stepDefMap = new Map<string, import('@/lib/brewing/process/types').ProcessStep>()
  for (const stage of manual.stages) {
    for (const step of stage.steps) {
      stepDefMap.set(step.id, step)
    }
  }

  // Build ResolveCtx for injectValues (resolving targetValueKey)
  const resolveCtx = {
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

  const logs: LogEntry[] = []
  for (const stepId of session.resolvedSteps) {
    const stepState = session.steps[stepId]
    if (!stepState) continue
    const stepDef = stepDefMap.get(stepId)

    for (const log of stepState.logs) {
      // Find the matching LogField definition
      const logField = stepDef?.logs.find((lf) => lf.key === log.field)

      // Resolve numeric target if targetValueKey is defined
      let target: number | undefined
      if (logField?.targetValueKey) {
        // Construct a minimal ValueToken for injectValues
        const token = {
          key: logField.targetValueKey,
          label: logField.label,
          unit: logField.unit,
          source: 'calc' as const,
        }
        const resolved = injectValues(token, resolveCtx)
        if (resolved.value !== null && typeof resolved.value === 'number') {
          target = resolved.value
        }
      }

      logs.push({
        key: log.field,
        label: logField?.label ?? log.field,
        stepId,
        value: log.value,
        unit: logField?.unit,
        target,
        at: log.at,
      })
    }
  }

  // ── Results: derive from logs ─────────────────────────────────────────────────
  // Collect log values keyed by their log field key for O(1) priority resolution.
  const logByKey = new Map<string, number>()
  for (const entry of logs) {
    const v = entry.value
    if (typeof v !== 'number') continue
    // Store the LAST logged value for any given key (latest wins within a key).
    logByKey.set(entry.key, v)
  }

  const results: BatchResults = {}

  // OG: prefer the most definitive / final reading
  //   og-final > og-measured > og-at-pitch
  results.measuredOG =
    logByKey.get('og-final') ?? logByKey.get('og-measured') ?? logByKey.get('og-at-pitch')

  // FG: prefer the most final/stable reading
  //   fg-final > stable-fg-3 > stable-fg-2 > stable-fg-1 > measured-fg > fg-reading-2 > fg-reading-1
  results.measuredFG =
    logByKey.get('fg-final') ??
    logByKey.get('stable-fg-3') ??
    logByKey.get('stable-fg-2') ??
    logByKey.get('stable-fg-1') ??
    logByKey.get('measured-fg') ??
    logByKey.get('fg-reading-2') ??
    logByKey.get('fg-reading-1')

  // Pre-boil gravity and volume
  const pbg = logByKey.get('preboil-gravity')
  if (pbg !== undefined) results.preBoilGravity = pbg

  const pbv = logByKey.get('preboil-volume')
  if (pbv !== undefined) results.preBoilVolume_L = pbv

  // Into-fermenter volume
  const ifv = logByKey.get('into-fermenter-volume')
  if (ifv !== undefined) results.intoFermenter_L = ifv

  // Compute measuredABV when both OG and FG are known.
  // Use the equipment profile's abvFormula so the measured result matches
  // the recipe calculation (e.g. 'advanced' for more accurate post-boil gravity correction).
  if (results.measuredOG !== undefined && results.measuredFG !== undefined) {
    results.measuredABV = calcABV(
      results.measuredOG,
      results.measuredFG,
      equipment?.abvFormula ?? 'simple',
    )
  }

  // Brewhouse efficiency (I3): requires measuredOG + intoFermenter_L + fermentables
  if (
    results.measuredOG !== undefined &&
    results.intoFermenter_L !== undefined &&
    recipeSnapshot !== undefined &&
    recipeSnapshot.fermentables.length > 0
  ) {
    results.brewhouseEfficiency_pct = calcBrewhouseEfficiency({
      measuredOG: results.measuredOG,
      intoFermenter_L: results.intoFermenter_L,
      fermentables: recipeSnapshot.fermentables,
    })
  }

  // Apparent attenuation (I3): requires both OG and FG
  if (results.measuredOG !== undefined && results.measuredFG !== undefined) {
    results.apparentAttenuation_pct = apparentAttenuationPct(results.measuredOG, results.measuredFG)
  }

  // ── Assemble ─────────────────────────────────────────────────────────────────
  return {
    // Identity: use existing if re-mapping, otherwise use injected values
    id: existing?.id ?? id,
    batchNo: existing?.batchNo ?? batchNo,
    startedAt: existing?.startedAt ?? now,

    // Always-updated
    name: session.recipeName ?? recipe?.name ?? 'Unnamed Batch',
    status,
    recipeId: session.recipeId,
    equipmentProfileId: recipe?.equipmentProfileId,
    recipeSnapshot,
    equipmentSnapshot,
    computedTargets,
    // Which board vessel this brew lives in. Prefer the freshly-supplied id;
    // fall back to whatever was previously captured so a re-map (which may omit
    // it) never drops the link. Stays undefined for manual brews with no vessel.
    fermenterBoardId: fermenterId ?? existing?.fermenterBoardId,
    // The yeast lot pitched at brew start. Prefer the session's own record;
    // fall back to whatever was previously captured on a re-map; omit the key
    // entirely when neither is set (conditional spread — byte-identity safe).
    ...(session.yeastLotId
      ? { yeastLotId: session.yeastLotId }
      : existing?.yeastLotId
        ? { yeastLotId: existing.yeastLotId }
        : {}),
    // `yeastDeducted` is set OUTSIDE this mapper (the guided-runner's mint
    // effect patches it onto the persisted batch directly) and only ever
    // transitions false → true. This mapper is a WHITELIST — any persistent
    // `Batch` field set outside of it must be explicitly carried from
    // `existing` here, or a later re-map (e.g. `completeBrew`, which saves
    // this literal directly rather than through the shallow-merge `patch()`)
    // silently erases it. Conditional spread keeps a never-deducted brew
    // byte-identical (key omitted when falsy).
    ...(existing?.yeastDeducted ? { yeastDeducted: true } : {}),
    // Resolve resolved step IDs → full ProcessStep definitions from the manual
    // (falls back to an empty placeholder if a step id is somehow unknown).
    process: session.resolvedSteps
      .map((sid) => stepDefMap.get(sid))
      .filter((s): s is import('@/lib/brewing/process/types').ProcessStep => s !== undefined),
    logs,
    timers: [],
    results,

    // Timestamps
    completedAt,
    brewedAt: existing?.brewedAt ?? now,
    archivedAt,
    updatedAt: now,
    schemaVersion: 1,
  }
}
