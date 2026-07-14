'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { StarRatingDisplay } from '@/components/ui/star-rating'
import { diffRecipes, type IngredientChange, type RecipeDiff } from '@/lib/brewing/recipe/diff'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { useBatchesStore } from '@/stores/batches-store'

/** Date a batch is "brewed on" — the `dateOf` convention (`brewedAt ?? startedAt`). */
function dateOf(b: Batch): string {
  return b.brewedAt ?? b.startedAt
}

/**
 * Brew history for a recipe. A recipe's "versions" are the `recipeSnapshot`s that
 * batches froze at brew time; the versions of THIS recipe are the batches whose
 * `recipeId === recipe.id`, newest-first. Renders a "changed since last brew"
 * callout (latest snapshot vs the live recipe) plus a list of brews, each with a
 * compact diff against the immediately-older brew's snapshot.
 */
export function BrewHistory({ recipe }: { recipe: Recipe }) {
  const { batches, isLoading } = useBatchesStore()

  const brews = useMemo(
    () =>
      batches
        .filter((b) => b.recipeId === recipe.id)
        .sort((a, b) => Date.parse(dateOf(b)) - Date.parse(dateOf(a))),
    [batches, recipe.id],
  )

  if (isLoading) {
    return <p className="batchlist-empty">Loading…</p>
  }
  if (brews.length === 0) {
    return <p className="batchlist-empty">No brews yet — brew this recipe to start its history.</p>
  }

  // Newest brew that froze a snapshot (brews is newest-first).
  const latestSnapshotBrew = brews.find((b) => b.recipeSnapshot)
  const sinceLast = latestSnapshotBrew?.recipeSnapshot
    ? diffRecipes(latestSnapshotBrew.recipeSnapshot, recipe)
    : null

  return (
    <div className="batchlist flex flex-col gap-3">
      {sinceLast && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
          {sinceLast.isEmpty ? (
            <p className="text-sm text-muted-foreground">No changes since your last brew.</p>
          ) : (
            <>
              <p className="text-sm font-medium">
                Recipe changed since brew #{latestSnapshotBrew?.batchNo}
              </p>
              <DiffChips diff={sinceLast} />
            </>
          )}
        </div>
      )}

      <ul className="batchlist-rows">
        {brews.map((b, i) => {
          const older = brews[i + 1]
          const olderSnap = older?.recipeSnapshot
          const curSnap = b.recipeSnapshot
          const diff = olderSnap && curSnap ? diffRecipes(olderSnap, curSnap) : null
          return (
            <li key={b.id} className="flex flex-col gap-2">
              <div className="batchlist-row">
                <div className="batchlist-row-main">
                  <span className="batchlist-no">#{b.batchNo}</span>
                  <span className="batchlist-name">{b.name}</span>
                  <span className="batchlist-no">{new Date(dateOf(b)).toLocaleDateString()}</span>
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
              </div>
              {!older ? (
                <p className="pl-1 text-xs text-muted-foreground">First brew</p>
              ) : diff == null ? null : diff.isEmpty ? (
                <p className="pl-1 text-xs text-muted-foreground">
                  No changes from brew #{older.batchNo}
                </p>
              ) : (
                <DiffChips diff={diff} />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Compact set of `.mini-alert` chips describing one `RecipeDiff`. */
function DiffChips({ diff }: { diff: RecipeDiff }) {
  return (
    <div className="ferm-alerts">
      {diff.fields.map((f) => (
        <span key={`field:${f.label}`} className="mini-alert info">
          {f.label}: {fmtField(f.from)} → {fmtField(f.to)}
        </span>
      ))}
      {diff.ingredients.map((c) => (
        <span key={`${c.kind}:${c.key}:${c.change}`} className={`mini-alert ${chipTone(c.change)}`}>
          {chipLabel(c)}
        </span>
      ))}
    </div>
  )
}

function chipTone(change: IngredientChange['change']): string {
  if (change === 'added') return 'go'
  if (change === 'removed') return 'warn'
  return 'info'
}

function chipLabel(c: IngredientChange): string {
  if (c.change === 'added') return `+ ${c.name} (${c.to})`
  if (c.change === 'removed') return `- ${c.name} (${c.from})`
  return `${c.name}: ${c.from} → ${c.to}`
}

function fmtField(v?: string | number): string {
  return v == null ? '—' : String(v)
}
