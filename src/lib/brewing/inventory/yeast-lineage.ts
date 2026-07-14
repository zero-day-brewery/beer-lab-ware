// Pure lineage builder: groups yeast lots by strain and assembles the parent→child
// forest from parentLotId. Every lot is accounted for — a lot whose parent is missing
// (or is part of a cycle with no acyclic entry) is surfaced as an orphan, never dropped.
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

export interface LineageNode {
  lot: YeastLot
  children: LineageNode[]
  depth: number
  /** True ONLY for a root whose `parentLotId` is set but points outside the
   *  strain's lot set (its real parent was deleted or belongs elsewhere) —
   *  the subtree is still built normally, this just flags the root so the UI
   *  can badge "parent missing" without flattening the lineage. False for
   *  genuine roots (no parentLotId) and for every non-root child. */
  orphaned: boolean
}
export interface StrainLineage {
  strain: string
  roots: LineageNode[]
  orphanLots: YeastLot[]
  maxGeneration: number
}

const norm = (s: string) => s.trim().toLowerCase()

export function buildLineage(lots: YeastLot[]): StrainLineage[] {
  const byStrain = new Map<string, { display: string; lots: YeastLot[] }>()
  for (const lot of lots) {
    const key = norm(lot.strain)
    let entry = byStrain.get(key)
    if (!entry) {
      entry = { display: lot.strain, lots: [] }
      byStrain.set(key, entry)
    }
    entry.lots.push(lot)
  }

  const out: StrainLineage[] = []
  for (const { display, lots: group } of byStrain.values()) {
    const placed = new Set<string>()
    const byId = new Set(group.map((l) => l.id))

    const build = (
      lot: YeastLot,
      depth: number,
      path: Set<string>,
      orphaned: boolean,
    ): LineageNode => {
      placed.add(lot.id)
      const children: LineageNode[] = []
      for (const cand of group) {
        if (cand.parentLotId === lot.id && !path.has(cand.id) && !placed.has(cand.id)) {
          const nextPath = new Set(path).add(cand.id)
          children.push(build(cand, depth + 1, nextPath, false))
        }
      }
      return { lot, children, depth, orphaned }
    }

    // Roots = no parentLotId, OR the parentLotId points OUTSIDE this strain's lot
    // set (the real parent was deleted, or belongs to a different strain group).
    // The latter is an "orphaned root": its subtree is built normally (a
    // mid-chain delete must not flatten its descendants), it's just flagged so
    // the UI can badge "parent missing" on that one node.
    const roots: LineageNode[] = []
    for (const lot of group) {
      const missingParent = !!lot.parentLotId && !byId.has(lot.parentLotId)
      const isRoot = !lot.parentLotId || missingParent
      if (isRoot && !placed.has(lot.id)) roots.push(build(lot, 0, new Set([lot.id]), missingParent))
    }

    // Never-drop sweep: any lot not placed in the forest (pure cycles — every
    // node's parent is IN-set but reachability loops back with no acyclic entry
    // point) becomes an orphan. Guarantees total conservation.
    const orphanLots = group.filter((l) => !placed.has(l.id))

    out.push({
      strain: display,
      roots,
      orphanLots,
      maxGeneration: group.reduce((m, l) => Math.max(m, l.generation), 0),
    })
  }
  return out
}
