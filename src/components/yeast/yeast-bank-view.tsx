'use client'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import { BrandMark } from '@/components/brand/brand-mark'
import { YeastEmptyScene } from '@/components/brand/empty-scenes'
import { LotEditor } from '@/components/yeast/lot-editor'
import { StrainLineage } from '@/components/yeast/strain-lineage'
import { buildLineage } from '@/lib/brewing/inventory/yeast-lineage'
import { selectYeastLot } from '@/lib/brewing/inventory/yeast-selection'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { batchRepo } from '@/lib/db/repos/batch'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { reportDbError } from '@/lib/diagnostics/error-log'

/** Live-query all yeast lots. Mirrors the retired inventory panel's local hook. */
function useYeastLots(): YeastLot[] {
  const [lots, setLots] = useState<YeastLot[]>([])
  useEffect(() => {
    const sub = liveQuery(() => yeastLotsRepo.list()).subscribe({
      next: (rows) => setLots(rows),
      error: (e) => reportDbError('yeast-lots', e),
    })
    return () => sub.unsubscribe()
  }, [])
  return lots
}

/** Live-query batches → `id -> batchNo`, so a lineage node's harvest-batch link
 *  can show the real sequential batch number instead of a UUID fragment. */
function useBatchNoById(): Map<string, number> {
  const [byId, setById] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    const sub = liveQuery(() => batchRepo.list()).subscribe({
      next: (rows) => setById(new Map(rows.map((b) => [b.id, b.batchNo]))),
      error: (e) => reportDbError('batches', e),
    })
    return () => sub.unsubscribe()
  }, [])
  return byId
}

export function YeastBankView() {
  const lots = useYeastLots()
  const batchNoById = useBatchNoById()
  const [addingLot, setAddingLot] = useState(false)
  const lineages = useMemo(() => buildLineage(lots), [lots])

  // "Use next" = the oldest in-stock lot per strain that clears the viability
  // floor — the FIFO-viable pick `selectYeastLot` would hand a brew day.
  // Ported from the retired inventory panel's `useNextIds` computation.
  const useNextIds = useMemo(() => {
    const now = new Date()
    const ids = new Set<string>()
    for (const line of lineages) {
      const sel = selectYeastLot({ strain: line.strain, requiredCells_B: 0, lots, now })
      if (sel.chosen) ids.add(sel.chosen.id)
    }
    return ids
  }, [lineages, lots])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark size={44} />
            <div>
              <span className="eyebrow">🧬 Repitch lineage</span>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Yeast Bank</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every strain's generation trail — from fresh pitch to harvested slurry.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setAddingLot((v) => !v)} className="btn-primary">
            <span aria-hidden="true">＋</span>
            <span>{addingLot ? 'Cancel' : 'New lot'}</span>
          </button>
        </div>
      </header>

      {addingLot && (
        <LotEditor onSave={() => setAddingLot(false)} onCancel={() => setAddingLot(false)} />
      )}

      {lineages.length === 0 ? (
        !addingLot && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <YeastEmptyScene size={140} />
            <p className="text-sm text-muted-foreground">
              No yeast lots tracked yet — waiting to bud. Track your first pitch above to start the
              lineage.
            </p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-8">
          {lineages.map((line) => (
            <StrainLineage
              key={line.strain}
              lineage={line}
              useNextIds={useNextIds}
              batchNoById={batchNoById}
            />
          ))}
        </div>
      )}
    </div>
  )
}
