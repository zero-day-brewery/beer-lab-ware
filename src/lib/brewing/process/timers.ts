/**
 * Pure timer builder for the guided brew runner. Converts a step's TimerSpec[]
 * into absolute-time TimerInstance[] (fireAt ISO) so timers survive reload.
 * The boil master derives child hop-addition alarms from recipe.hops[].time_min:
 * an addition with N minutes-remaining fires at (boilTime − N) minutes into the boil.
 * PURE — no DOM, Dexie, or fetch.
 */
import type { StepId, TimerSpec } from '@/lib/brewing/process/types'
import type { Recipe } from '@/lib/brewing/types/recipe'

export interface TimerInstance {
  id: string
  stepId: StepId
  label: string
  durationMin: number
  fireAt: string
  isBoilMaster: boolean
  parentId?: string
}

export interface BuildTimerCtx {
  recipe?: Recipe
  now: string
}

const MS_PER_MIN = 60_000

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MS_PER_MIN).toISOString()
}

function durationFor(spec: TimerSpec, recipe?: Recipe): number {
  const d = spec.durationFrom
  if (d.kind === 'fixed') return d.minutes
  if (d.kind === 'recipe') return recipe?.boilTime_min ?? 0
  // mashStep
  return recipe?.mashSteps[d.index]?.time_min ?? 0
}

/** Hop uses that participate in the boil-master schedule. */
const BOIL_USES = new Set(['boil', 'first-wort', 'whirlpool'])

export function boilMasterAlarms(
  parentId: string,
  stepId: StepId,
  recipe: Recipe,
  now: string,
): TimerInstance[] {
  const boil = recipe.boilTime_min
  return recipe.hops
    .filter((h) => BOIL_USES.has(h.use))
    .map((h, i) => {
      const offset = h.use === 'first-wort' ? 0 : Math.min(Math.max(0, boil - h.time_min), boil)
      return {
        id: `${parentId}--hop-${i}`,
        stepId,
        label: `${h.snapshot.name} (${h.time_min} min)`,
        durationMin: offset,
        fireAt: addMinutes(now, offset),
        isBoilMaster: false,
        parentId,
      }
    })
}

export function buildTimers(
  stepId: StepId,
  specs: TimerSpec[],
  ctx: BuildTimerCtx,
): TimerInstance[] {
  const out: TimerInstance[] = []
  for (const spec of specs) {
    const durationMin = durationFor(spec, ctx.recipe)
    out.push({
      id: spec.id,
      stepId,
      label: spec.label,
      durationMin,
      fireAt: addMinutes(ctx.now, durationMin),
      isBoilMaster: spec.isBoilMaster === true,
    })
    if (spec.isBoilMaster && ctx.recipe) {
      out.push(...boilMasterAlarms(spec.id, stepId, ctx.recipe, ctx.now))
    }
  }
  return out
}
