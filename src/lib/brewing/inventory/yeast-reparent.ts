import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Valid new parents for re-parenting an orphaned yeast lot.
 *
 * A lineage is per-strain (see `buildLineage`), so a new parent must be the
 * SAME strain. It also excludes the lot itself and ALL its descendants —
 * choosing one of those would create a cycle, which `buildLineage` would then
 * trap the whole subtree in. Cycle-safe against already-corrupt data (a data
 * loop terminates via the visited set).
 *
 * Pure — just changing `parentLotId`; generation and everything else is
 * preserved by the caller (a deleted parent doesn't change the recorded
 * repitch count).
 */
export function reparentCandidates(lot: YeastLot, allLots: readonly YeastLot[]): YeastLot[] {
  const sameStrain = allLots.filter((l) => norm(l.strain) === norm(lot.strain))
  const excluded = descendantIds(lot.id, sameStrain)
  excluded.add(lot.id)
  return sameStrain.filter((l) => !excluded.has(l.id))
}

/** All lots reachable by walking parentLotId links DOWN from `rootId`. */
function descendantIds(rootId: string, lots: readonly YeastLot[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const l of lots) {
    if (!l.parentLotId) continue
    const arr = childrenOf.get(l.parentLotId)
    if (arr) arr.push(l.id)
    else childrenOf.set(l.parentLotId, [l.id])
  }
  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    for (const child of childrenOf.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        stack.push(child)
      }
    }
  }
  return out
}
