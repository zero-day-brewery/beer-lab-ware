'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HarvestForm } from '@/components/yeast/harvest-form'
import { GENERATION_WARN_AT } from '@/lib/brewing/inventory/yeast-harvest'
import type {
  LineageNode,
  StrainLineage as StrainLineageT,
} from '@/lib/brewing/inventory/yeast-lineage'
import { reparentCandidates } from '@/lib/brewing/inventory/yeast-reparent'
import { VIABILITY_FLOOR_PCT } from '@/lib/brewing/inventory/yeast-selection'
import { currentViability, viableCells } from '@/lib/brewing/inventory/yeast-viability'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { reportDbError } from '@/lib/diagnostics/error-log'

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** A Date as a LOCAL `YYYY-MM-DD` (for a `<input type="date">` value) — avoids
 *  the UTC roll-over `toISOString().slice(0,10)` causes in the evening. */
function localYMD(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Local midnight of a Date, in ms — for whole-calendar-day differences. */
function localDayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Direct-child count per lot id, across the whole family (tree + orphans —
 * `buildLineage` guarantees every lot lands in one or the other, so walking
 * both covers 100% of the strain's lots). Powers the delete confirm's
 * orphan-count warning (design spec §8: deleting a parent orphans its
 * children; they become roots via the orphan path).
 */
function childCountsOf(lineage: StrainLineageT): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (parentId: string | undefined) => {
    if (!parentId) return
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1)
  }
  const walk = (node: LineageNode) => {
    bump(node.lot.parentLotId)
    for (const child of node.children) walk(child)
  }
  for (const root of lineage.roots) walk(root)
  for (const lot of lineage.orphanLots) bump(lot.parentLotId)
  return counts
}

/**
 * Layout A — horizontal generation flow for a single strain's repitch tree.
 * A root lot buds right into its children (stacked vertically at a split),
 * each child budding further right in turn. Scrolls horizontally on its own
 * (`.lineage-scroll`) so a deep lineage never widens the page body.
 *
 * `useNextIds`/`batchNoById` are optional (default empty) so lightweight tests
 * that only care about the tree shape can render `<StrainLineage lineage={…} />`
 * without wiring the Yeast Bank's live-query hooks.
 */
export function StrainLineage({
  lineage,
  useNextIds = new Set<string>(),
  batchNoById = new Map<string, number>(),
}: {
  lineage: StrainLineageT
  useNextIds?: Set<string>
  batchNoById?: Map<string, number>
}) {
  const now = new Date()
  const childCounts = childCountsOf(lineage)
  // Flat list of THIS strain's lots — the candidate pool for re-parenting an
  // orphan (buildLineage puts every lot in a root subtree OR orphanLots).
  const strainLots = useMemo(() => {
    const acc: YeastLot[] = []
    const walk = (n: LineageNode) => {
      acc.push(n.lot)
      for (const c of n.children) walk(c)
    }
    for (const r of lineage.roots) walk(r)
    acc.push(...lineage.orphanLots)
    return acc
  }, [lineage])
  return (
    <section className="lineage-strain tap-card">
      <div className="lineage-strain-head">
        <h3 className="lineage-strain-heading">{lineage.strain}</h3>
        <span className="lineage-strain-meta">
          gen 0–{lineage.maxGeneration} · {lineage.roots.length} root
          {lineage.roots.length === 1 ? '' : 's'}
        </span>
      </div>

      {lineage.roots.length > 0 && (
        <div className="lineage-scroll">
          <div className="lineage-tree">
            {lineage.roots.map((root) => (
              <LineageBranch
                key={root.lot.id}
                node={root}
                now={now}
                useNextIds={useNextIds}
                batchNoById={batchNoById}
                childCounts={childCounts}
                strainLots={strainLots}
              />
            ))}
          </div>
        </div>
      )}

      {lineage.orphanLots.length > 0 && (
        <div className="lineage-orphans">
          <h4 className="lineage-orphans-heading">Parent missing</h4>
          <ul className="lineage-orphans-list">
            {lineage.orphanLots.map((lot) => (
              <li key={lot.id}>
                <LineageNodeCard
                  lot={lot}
                  now={now}
                  note="parent missing"
                  orphaned
                  strainLots={strainLots}
                  useNextIds={useNextIds}
                  batchNoById={batchNoById}
                  childCount={childCounts.get(lot.id) ?? 0}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function LineageBranch({
  node,
  now,
  useNextIds,
  batchNoById,
  childCounts,
  strainLots,
}: {
  node: LineageNode
  now: Date
  useNextIds: Set<string>
  batchNoById: Map<string, number>
  childCounts: Map<string, number>
  strainLots: YeastLot[]
}) {
  return (
    <div className="lineage-branch">
      <LineageNodeCard
        lot={node.lot}
        now={now}
        useNextIds={useNextIds}
        batchNoById={batchNoById}
        childCount={childCounts.get(node.lot.id) ?? node.children.length}
        orphaned={node.orphaned}
        strainLots={strainLots}
      />
      {node.children.length > 0 && (
        <div className="lineage-children">
          {node.children.map((child) => (
            <LineageBranch
              key={child.lot.id}
              node={child}
              now={now}
              useNextIds={useNextIds}
              batchNoById={batchNoById}
              childCounts={childCounts}
              strainLots={strainLots}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LineageNodeCard({
  lot,
  now,
  note,
  orphaned = false,
  useNextIds,
  batchNoById,
  childCount = 0,
  strainLots,
}: {
  lot: YeastLot
  now: Date
  note?: string
  /** True for a tree-rendered root whose real parent is missing (deleted or
   *  out-of-set) — draws an inline "parent missing" badge in the header,
   *  same affordance as the flat orphan strip's `note` but without pulling
   *  the node (and its subtree) out of the tree. */
  orphaned?: boolean
  useNextIds: Set<string>
  batchNoById: Map<string, number>
  childCount?: number
  /** This strain's full lot set — the candidate pool for re-parenting when
   *  `orphaned`. Only read on the orphan path. */
  strainLots: YeastLot[]
}) {
  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(() => String(lot.quantity))
  const [harvesting, setHarvesting] = useState(false)
  const [parentDraft, setParentDraft] = useState('') // '' = make root
  const [measuring, setMeasuring] = useState(false)
  const [cellsDraft, setCellsDraft] = useState('')
  const [measuredAtDraft, setMeasuredAtDraft] = useState(() => localYMD(now))

  const pct = currentViability(lot, now)
  const cells = viableCells(lot, now)
  const measured = lot.measuredViableCells_B != null && lot.measuredAt != null
  const measuredDaysAgo = measured
    ? Math.round(
        (localDayStart(now) - localDayStart(new Date(lot.measuredAt as string))) / 86_400_000,
      )
    : 0
  const spent = lot.quantity === 0
  const drift = lot.generation >= GENERATION_WARN_AT
  const belowFloor = pct < VIABILITY_FLOOR_PCT
  const useNext = useNextIds.has(lot.id)

  const classes = ['lineage-node', spent && 'spent', drift && 'lineage-node--drift']
    .filter(Boolean)
    .join(' ')

  // Inline qty edit — ported from the retired inventory panel's `LotRow`.
  const saveQty = async () => {
    const n = Number(qtyDraft)
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Enter a quantity ≥ 0')
      return
    }
    try {
      await yeastLotsRepo.save({ ...lot, quantity: n })
      toast.success(`Updated "${lot.name}"`)
      setEditingQty(false)
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`)
    }
  }

  // Delete — ported from the retired inventory panel's `LotRow.onDelete`, plus
  // the orphan-child warning design spec §8 requires: deleting a parent lot
  // orphans its children, so the confirm surfaces the count before the user
  // commits (they become roots via the orphan path — see `buildLineage`).
  const onDelete = async () => {
    const message =
      childCount > 0
        ? `Delete "${lot.name}"? ${childCount} child lot${childCount === 1 ? '' : 's'} will lose ${
            childCount === 1 ? 'its' : 'their'
          } parent and become an orphan (root) lot${childCount === 1 ? '' : 's'}.`
        : `Delete "${lot.name}"?`
    if (!confirm(message)) return
    try {
      await yeastLotsRepo.remove(lot.id)
      toast.success(`Deleted "${lot.name}"`)
    } catch (err) {
      reportDbError('yeast-lots', err)
    }
  }

  // Re-parent an orphan: change ONLY parentLotId (generation is preserved — a
  // deleted parent doesn't change the recorded repitch count). '' = make it a root.
  const reassignParent = async () => {
    try {
      await yeastLotsRepo.save({ ...lot, parentLotId: parentDraft || undefined })
      toast.success(parentDraft ? `Re-parented "${lot.name}"` : `"${lot.name}" is now a root`)
    } catch (err) {
      toast.error(`Re-parent failed: ${(err as Error).message}`)
    }
  }

  // Record a direct viable-cell count (already viability-discounted, e.g. a
  // hemocytometer reading). Overrides the age estimate in viableCells(),
  // decaying forward from measuredAt. "Latest only" — overwrites any prior.
  const saveMeasurement = async () => {
    const n = Number(cellsDraft)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Enter a cell count > 0 (billions)')
      return
    }
    // Parse the date-input value as LOCAL midnight, not UTC (new Date('YYYY-MM-DD')
    // is UTC and would shift the day for anyone behind UTC).
    const at = new Date(`${measuredAtDraft}T00:00:00`)
    if (Number.isNaN(at.getTime())) {
      toast.error('Enter a valid measurement date')
      return
    }
    try {
      await yeastLotsRepo.save({ ...lot, measuredViableCells_B: n, measuredAt: at.toISOString() })
      toast.success(`Measured "${lot.name}" at ${n} B`)
      setMeasuring(false)
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  // Revert to the age-based estimate by dropping the direct count.
  const clearMeasurement = async () => {
    try {
      await yeastLotsRepo.save({ ...lot, measuredViableCells_B: undefined, measuredAt: undefined })
      toast.success(`Reverted "${lot.name}" to the age estimate`)
    } catch (err) {
      toast.error(`Clear failed: ${(err as Error).message}`)
    }
  }

  return (
    <div
      data-testid="lineage-node"
      className={classes}
      style={{
        ['--fc' as string]: belowFloor ? 'var(--destructive)' : 'var(--malt, var(--primary))',
      }}
    >
      <div className="lineage-node-head">
        <span className="lineage-node-name">{lot.name}</span>
        <span className="lineage-node-gen">gen {lot.generation}</span>
        {drift && (
          <span
            className="mini-alert lineage-node-drift-badge"
            title={`Generation ${lot.generation} — consider a fresh pitch (strain drift)`}
          >
            ⚠ drift
          </span>
        )}
        {useNext && <span className="mini-alert go">use next</span>}
        {belowFloor && <span className="mini-alert warn">low viability</span>}
        {orphaned && !note && (
          <span
            className="mini-alert warn"
            title="This lot's recorded parent is missing or was deleted"
          >
            parent missing
          </span>
        )}
      </div>

      <div className="ferm-progress">
        <div className="bar">
          <div className="fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <div className="readout">
          <span className="pct">~{pct.toFixed(0)}% est.</span>
          <span>
            {measured ? '' : '~'}
            {cells.toFixed(1)} B
          </span>
          {measured && (
            <span
              className="mini-alert go"
              data-testid="measured-badge"
              title={`Direct count on ${new Date(
                lot.measuredAt as string,
              ).toLocaleDateString()} overrides the age estimate; decays forward from there`}
            >
              measured {measuredDaysAgo <= 0 ? 'today' : `${measuredDaysAgo}d ago`}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        {editingQty ? (
          <>
            <input
              type="number"
              step="0.01"
              min="0"
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              className="field w-16"
              aria-label={`Quantity for ${lot.name}`}
            />
            <button type="button" onClick={saveQty} className="btn-ghost">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingQty(false)
                setQtyDraft(String(lot.quantity))
              }}
              className="btn-ghost"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="font-mono">
              {fmtQty(lot.quantity)} {lot.unit}
            </span>
            <button type="button" onClick={() => setEditingQty(true)} className="btn-ghost">
              Edit qty
            </button>
            {!spent && (
              <button type="button" onClick={() => setHarvesting(true)} className="btn-ghost">
                Harvest from this lot
              </button>
            )}
            <button type="button" onClick={() => setMeasuring(true)} className="btn-ghost">
              Measure cells
            </button>
            {measured && (
              <button type="button" onClick={clearMeasurement} className="btn-ghost">
                Clear measurement
              </button>
            )}
            <button type="button" onClick={onDelete} className="btn-ghost danger">
              Delete
            </button>
          </>
        )}
      </div>

      {orphaned && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="reparent-row">
          <label className="flex items-center gap-1">
            <span>Set parent</span>
            <select
              value={parentDraft}
              onChange={(e) => setParentDraft(e.target.value)}
              aria-label={`New parent for ${lot.name}`}
              className="field"
            >
              <option value="">— No parent (make root) —</option>
              {reparentCandidates(lot, strainLots).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (gen {c.generation})
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={reassignParent} className="btn-ghost">
            Reassign
          </button>
        </div>
      )}

      {measuring && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="measure-row">
          <label className="flex items-center gap-1">
            <span>Viable cells (B)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={cellsDraft}
              onChange={(e) => setCellsDraft(e.target.value)}
              aria-label={`Measured viable cells (billions) for ${lot.name}`}
              className="field w-20"
            />
          </label>
          <label className="flex items-center gap-1">
            <span>on</span>
            <input
              type="date"
              value={measuredAtDraft}
              onChange={(e) => setMeasuredAtDraft(e.target.value)}
              aria-label={`Measurement date for ${lot.name}`}
              className="field"
            />
          </label>
          <button type="button" onClick={saveMeasurement} className="btn-ghost">
            Save measurement
          </button>
          <button
            type="button"
            onClick={() => {
              setMeasuring(false)
              setCellsDraft('')
            }}
            className="btn-ghost"
          >
            Cancel
          </button>
        </div>
      )}

      {harvesting && <HarvestForm parentLot={lot} onDone={() => setHarvesting(false)} />}

      {lot.harvestedFromBatchId && (
        <Link href={`/logbook/view?id=${lot.harvestedFromBatchId}`} className="lineage-node-batch">
          ◈ #{batchNoById.get(lot.harvestedFromBatchId) ?? '—'}
        </Link>
      )}

      {note && <p className="lineage-node-note">{note}</p>}
    </div>
  )
}
