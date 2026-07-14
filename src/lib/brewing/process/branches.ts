/**
 * Pure branch resolution for the guided brew manual.
 * Maps a serializable BranchPredicate + (recipe, choices, volumes) -> boolean,
 * and resolves the full active StepId set for a ProcessManual.
 * PURE: no DOM/Dexie/fetch/store imports.
 */

import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Volumes } from '@/lib/brewing/types/results'
import type { BranchPredicate, ProcessChoices, ProcessManual, StepId } from './types'

const MASH_OUT_RE = /mash[\s-]?out/i

export function evalPredicate(
  p: BranchPredicate,
  recipe: Recipe | undefined,
  choices: ProcessChoices,
  vols: Volumes | undefined,
): boolean {
  switch (p.t) {
    case 'stepMash':
      return (recipe?.mashSteps.length ?? 0) > 1
    case 'hasMashOut':
      return (recipe?.mashSteps ?? []).some((s) => MASH_OUT_RE.test(s.name))
    case 'hasWhirlpool':
      return (recipe?.hops ?? []).some((h) => h.use === 'whirlpool')
    case 'hasDryHop':
      return (recipe?.hops ?? []).some((h) => h.use === 'dry-hop')
    case 'hasMiscs':
      return (recipe?.miscs.length ?? 0) > 0
    case 'noSparge':
      return choices.noSparge === true || (vols != null && vols.spargeWater_L <= 0)
    case 'carbPath':
      return choices.carbPath === p.eq
    case 'usesStarter':
      return choices.usesStarter === true
    case 'pressureFromPitch':
      return choices.pressureFromPitch === true
    case 'not':
      return !evalPredicate(p.of, recipe, choices, vols)
  }
}

export function resolveBranches(
  manual: ProcessManual,
  recipe: Recipe | undefined,
  choices: ProcessChoices,
  vols: Volumes | undefined,
): Set<StepId> {
  const active = new Set<StepId>()
  for (const stage of manual.stages) {
    for (const step of stage.steps) {
      if (!step.branch || evalPredicate(step.branch, recipe, choices, vols)) {
        active.add(step.id)
      }
    }
  }
  return active
}
