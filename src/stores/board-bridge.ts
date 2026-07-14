'use client'
import { type BoardOp, projectEffects } from '@/lib/brewing/process/board-projection'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { BoardEffect } from '@/lib/brewing/process/types'
import { useSystemStore } from '@/stores/system-store'

// The guided runner speaks in the three canonical station names. In the array
// model a station op targets a *group* of equipment: 'brew' → every brew system,
// 'wortChiller' → every counterflow cooler, 'cooler' → every glycol cooler.
type StationName = 'brew' | 'wortChiller' | 'cooler'

/** Drive one station op onto the array model, guarded so replays are idempotent. */
function applyStation(station: StationName, to: 'idle' | 'active'): void {
  const s = useSystemStore.getState()
  if (station === 'brew') {
    for (const b of s.brewSystems) {
      if (b.status !== to) s.patchBrewSystem(b.id, { status: to })
    }
    return
  }
  const kind = station === 'wortChiller' ? 'counterflow' : 'glycol'
  for (const c of s.coolers) {
    if (c.kind === kind && c.status !== to) s.patchCooler(c.id, { status: to })
  }
}

/**
 * Execute a projected BoardOp[] against the live system-store.
 *
 * Station toggles are GUARDED on current state so replaying the same op-list on
 * session resume / store rehydrate is idempotent (no double-flip). The board is
 * a projection of the canonical BrewSession; this is the only place ops mutate it.
 */
export function applyOps(ops: BoardOp[], fermenterId = 'f1', batchId?: string): void {
  const store = useSystemStore.getState()
  for (const op of ops) {
    switch (op.op) {
      case 'startSession': {
        store.startBrew({
          recipeName: op.recipeName,
          additionsSummary: op.additionsSummary,
          skipped: op.skipped,
        })
        break
      }
      case 'station': {
        applyStation(op.station, op.to)
        break
      }
      case 'fermenter': {
        // At the fermenting transition, ALSO stamp the active batch id so the
        // fermenter mini-chart + dashboard sparkline can source readings by
        // Batch.id (not the recipe-name heuristic). GUARD: only write batchId
        // when one exists — never clobber the link with `undefined` on a
        // replay/re-map that has no active batch, and only stamp on the
        // 'fermenting' edge (later status moves must not re-stamp or wipe it).
        store.patchFermenter(
          fermenterId,
          op.to === 'fermenting' && batchId ? { status: op.to, batchId } : { status: op.to },
        )
        break
      }
      case 'endSession': {
        store.stopBrew()
        break
      }
      // Board no-ops in Phase 4 (no evolved board UI yet):
      case 'focusStage':
      case 'note':
        break
    }
  }
}

/** Project effects through the pure projection, then apply to the store.
 *  `batchId` is threaded from the guided runner (which owns the active batch id)
 *  so the fermenting transition can stamp `Fermenter.batchId` without importing
 *  the active-batch store here (keeps board-bridge dependency-light + cycle-free). */
export function applyEffects(
  effects: BoardEffect[],
  session: BrewSession,
  fermenterId = 'f1',
  batchId?: string,
): void {
  applyOps(projectEffects(effects, session), fermenterId, batchId)
}
