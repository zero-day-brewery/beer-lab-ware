/**
 * Board projection — PURE.
 *
 * Translates a step's resolved BoardEffect[] into a flat, serializable, ordered
 * list of board operations (BoardOp[]). This module performs NO store mutation
 * and imports NO Dexie/DOM/fetch — the board is a *projection* of the canonical
 * BrewSession. The op-list is executed by the store bridge (src/stores/board-bridge.ts),
 * which lives OUTSIDE the pure brewing engine.
 */
import type { BrewSession } from '@/lib/brewing/process/session'
import type { BoardEffect, StageId } from '@/lib/brewing/process/types'
import type { FermStatus } from '@/stores/system-store'

export type BoardOp =
  | { op: 'startSession'; recipeName?: string; additionsSummary?: string; skipped?: boolean }
  | { op: 'station'; station: 'brew' | 'wortChiller' | 'cooler'; to: 'idle' | 'active' }
  | { op: 'fermenter'; to: FermStatus }
  | { op: 'focusStage'; stage: StageId }
  | { op: 'endSession' }
  | { op: 'note'; text: string }

function startSessionOp(session: BrewSession): BoardOp {
  const op: BoardOp = { op: 'startSession' }
  if (session.recipeName != null) op.recipeName = session.recipeName
  const water = session.water
  if (water?.additionsSummary != null) op.additionsSummary = water.additionsSummary
  if (water?.skipped != null) op.skipped = water.skipped
  return op
}

export function projectEffects(effects: BoardEffect[], session: BrewSession): BoardOp[] {
  return effects.map((e): BoardOp => {
    switch (e.t) {
      case 'startSession':
        return startSessionOp(session)
      case 'station':
        return { op: 'station', station: e.station, to: e.to }
      case 'fermenter':
        return { op: 'fermenter', to: e.to }
      case 'stageFocus':
        return { op: 'focusStage', stage: e.stage }
      case 'endSession':
        return { op: 'endSession' }
      case 'note':
        return { op: 'note', text: e.text }
      default: {
        const _exhaustive: never = e
        return _exhaustive
      }
    }
  })
}
