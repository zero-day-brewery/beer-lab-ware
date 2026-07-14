'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { StarRatingDisplay } from '@/components/ui/star-rating'
import { type BatchStats, buildBatchStats } from '@/lib/brewing/batch/batch-stats'
import type { Batch } from '@/lib/brewing/types/batch'
import { useBatchesStore } from '@/stores/batches-store'

/**
 * Logbook "Dashboard" tab: a brew-history overview folded from the live batch
 * list through the pure `buildBatchStats` — a KPI stat row, a most-brewed
 * callout, and a dated brew timeline (newest-first). Token-driven, reusing the
 * existing `.stat-tile` / `.batchlist-*` / `.eyebrow` kit (no new CSS).
 */

/** Date a batch is considered "brewed on" — matches `trends.ts` `dateOf`. */
function brewDate(b: Batch): string {
  return b.brewedAt ?? b.startedAt
}

/** Whole days since an ISO instant relative to `now` (UTC epoch math). */
function daysAgo(iso: string, now: Date): number | null {
  const ms = now.getTime() - Date.parse(iso)
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 86_400_000) : null
}

/** Human "N days ago" label; `''` for a future/unparseable date. */
function agoLabel(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return 'today'
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function BatchDashboard() {
  const { batches, isLoading } = useBatchesStore()
  const now = useMemo(() => new Date(), [])
  const stats = useMemo(() => buildBatchStats(batches, now), [batches, now])

  if (isLoading) return <p className="batchlist-empty">Loading…</p>

  if (batches.length === 0) {
    return <p className="batchlist-empty">No batches yet — start a brew.</p>
  }

  return (
    <section aria-label="Batch dashboard" className="flex flex-col gap-5">
      <KpiRow stats={stats} />
      <MostBrewed stats={stats} now={now} />
      <Timeline batches={batches} now={now} />
    </section>
  )
}

function KpiRow({ stats }: { stats: BatchStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <div className="stat-tile">
        <span className="num">{stats.total}</span>
        <span className="lbl">Total batches</span>
      </div>
      <div className="stat-tile">
        <span className="num">{stats.byStatus.complete}</span>
        <span className="lbl">Complete</span>
      </div>
      <div className="stat-tile">
        <span className="num">{stats.brewedThisMonth}</span>
        <span className="lbl">Brewed this month</span>
      </div>
      <div className="stat-tile">
        <span className="num">
          {stats.avgMeasuredABV === null ? '—' : `${stats.avgMeasuredABV.toFixed(1)}%`}
        </span>
        <span className="lbl">Avg ABV</span>
      </div>
      <div className="stat-tile">
        {stats.avgRating === null ? (
          <span className="num">—</span>
        ) : (
          <StarRatingDisplay value={Math.round(stats.avgRating)} />
        )}
        <span className="lbl">Avg rating</span>
      </div>
    </div>
  )
}

function MostBrewed({ stats, now }: { stats: BatchStats; now: Date }) {
  const parts: string[] = []
  if (stats.mostBrewedStyle) {
    parts.push(`${stats.mostBrewedStyle.label} ×${stats.mostBrewedStyle.count}`)
  }
  if (stats.mostBrewedType) {
    parts.push(`${stats.mostBrewedType.type} ×${stats.mostBrewedType.count}`)
  }
  if (stats.lastBrewDate) {
    const ago = agoLabel(daysAgo(stats.lastBrewDate, now))
    const dateLabel = new Date(stats.lastBrewDate).toLocaleDateString()
    parts.push(`Last brew ${dateLabel}${ago ? ` (${ago})` : ''}`)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">Most brewed</span>
      <p className="text-sm text-muted-foreground">
        {parts.length > 0 ? parts.join(' · ') : 'No recipe snapshots yet.'}
      </p>
    </div>
  )
}

function Timeline({ batches, now }: { batches: Batch[]; now: Date }) {
  // Newest-first by brew date (brewedAt ?? startedAt), independent of the store order.
  const sorted = useMemo(
    () => [...batches].sort((a, b) => Date.parse(brewDate(b)) - Date.parse(brewDate(a))),
    [batches],
  )

  return (
    <div className="flex flex-col gap-3">
      <span className="eyebrow">Brew timeline</span>
      <ul className="batchlist-rows">
        {sorted.map((b) => {
          const iso = brewDate(b)
          const dateLabel = new Date(iso).toLocaleDateString()
          const ago = agoLabel(daysAgo(iso, now))
          return (
            <li key={b.id} className="batchlist-row">
              <div className="batchlist-row-main">
                <span className="batchlist-no">
                  {dateLabel}
                  {ago ? ` · ${ago}` : ''}
                </span>
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
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
