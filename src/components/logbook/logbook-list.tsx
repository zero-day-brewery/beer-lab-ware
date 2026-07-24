'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LogbookEmptyScene } from '@/components/brand/empty-scenes'
import { StarRatingDisplay } from '@/components/ui/star-rating'
import type { Batch } from '@/lib/brewing/types/batch'
import { batchRepo } from '@/lib/db/repos/batch'
import { useBatchesStore } from '@/stores/batches-store'

type Filter = 'all' | Batch['status']

const FILTERS: Filter[] = ['all', 'in-progress', 'complete', 'archived']

export function LogbookList() {
  const { batches, isLoading } = useBatchesStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [undo, setUndo] = useState<Batch | null>(null)

  // In-memory status filter — no DB query, just slices the live Zustand list.
  const shown = useMemo(
    () => (filter === 'all' ? batches : batches.filter((b) => b.status === filter)),
    [batches, filter],
  )

  async function handleDelete(b: Batch) {
    await batchRepo.delete(b.id)
    setUndo(b)
  }

  async function handleUndo() {
    if (!undo) return
    try {
      await batchRepo.save(undo)
      setUndo(null)
    } catch (err) {
      // Keep `undo` set — the banner is the user's only recovery of a batch we
      // already deleted from the DB. Never let a failed restore silently eat it.
      console.error('[Logbook] undo restore failed:', err)
      toast.error('Could not restore the batch — try Undo again.')
    }
  }

  async function handleRebrew(b: Batch) {
    try {
      const batchNo = await batchRepo.nextBatchNo()
      const clone: Batch = {
        ...b,
        id: crypto.randomUUID(),
        batchNo,
        name: `${b.name} (re-brew)`,
        status: 'in-progress',
        // A re-brew is a FRESH brew: don't inherit the source batch's vessel or
        // its spent-yeast marker. Carrying fermenterBoardId would make the next
        // guided session on that vessel rehydrate this clone instead of minting
        // (see batchRepo.getOrCreateForBoard); carrying yeastDeducted would skip
        // the new pitch's deduction. The vessel is assigned when the brew starts.
        // (yeastLotId is intentionally kept — a re-brew of the same recipe keeps
        // its yeast selection and, with yeastDeducted cleared, deducts afresh.)
        fermenterBoardId: undefined,
        yeastDeducted: undefined,
        logs: [],
        timers: [],
        results: {},
        tasting: undefined,
        startedAt: new Date().toISOString(),
        brewedAt: undefined,
        completedAt: undefined,
        archivedAt: undefined,
        updatedAt: new Date().toISOString(),
      }
      await batchRepo.save(clone)
    } catch (err) {
      console.error('[Logbook] re-brew failed:', err)
      toast.error('Could not start the re-brew — check the console for details.')
    }
  }

  if (isLoading) return <p className="batchlist-empty">Loading…</p>

  return (
    <div className="batchlist">
      <div className="batchlist-filters">
        {FILTERS.map((f) => (
          <button
            type="button"
            key={f}
            className={`batchlist-filter${filter === f ? ' is-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {undo && (
        <div className="batchlist-undo" role="status">
          Deleted &ldquo;{undo.name}&rdquo;.{' '}
          <button type="button" className="batchlist-undo-btn" onClick={handleUndo}>
            Undo
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        batches.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <LogbookEmptyScene />
            <p className="batchlist-empty">No batches yet.</p>
          </div>
        ) : (
          <p className="batchlist-empty">No batches match this filter.</p>
        )
      ) : (
        <ul className="batchlist-rows">
          {shown.map((b) => (
            <li key={b.id} className="batchlist-row">
              <div className="batchlist-row-main">
                <span className="batchlist-no">#{b.batchNo}</span>
                <span className="batchlist-name">{b.name}</span>
                <span className={`batchlist-chip batchlist-chip--${b.status}`}>{b.status}</span>
                {b.tasting?.rating != null && (
                  <StarRatingDisplay value={b.tasting.rating} className="batchlist-stars" />
                )}
              </div>
              <div className="batchlist-actions">
                <Link className="batchlist-action" href={`/logbook/view?id=${b.id}`}>
                  View
                </Link>
                <button type="button" className="batchlist-action" onClick={() => handleRebrew(b)}>
                  Re-brew
                </button>
                <button
                  type="button"
                  className="batchlist-action batchlist-action--danger"
                  onClick={() => handleDelete(b)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
