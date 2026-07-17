'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  type BrewfatherImportResult,
  type BrewfatherPlan,
  buildBrewfatherPlan,
  executeBrewfatherImport,
} from '@/lib/brewing/brewfather/import'

/**
 * Brewfather migration section of the Import page. Two-step by design:
 * selecting files runs a PURE dry-run preview (counts + warnings, nothing
 * written); only the explicit Import button writes — through the existing
 * repos, idempotently (re-importing the same export duplicates nothing).
 */
export function BrewfatherImportSection() {
  const [plan, setPlan] = useState<BrewfatherPlan | null>(null)
  const [result, setResult] = useState<BrewfatherImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  const totalPlanned = plan
    ? plan.counts.recipes + plan.counts.batches + plan.counts.readings + plan.counts.inventoryItems
    : 0

  const onFiles = async (list: FileList) => {
    setBusy(true)
    setResult(null)
    try {
      const files = await Promise.all(
        Array.from(list).map(async (f) => ({ fileName: f.name, text: await f.text() })),
      )
      setPlan(buildBrewfatherPlan(files))
    } catch (err) {
      setPlan(null)
      toast.error(`Could not read files: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const onImport = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const res = await executeBrewfatherImport(plan)
      setResult(res)
      setPlan(null)
      const total =
        res.imported.recipes +
        res.imported.batches +
        res.imported.readings +
        res.imported.inventoryItems
      const skipped =
        res.skippedExisting.recipes +
        res.skippedExisting.batches +
        res.skippedExisting.readings +
        res.skippedExisting.inventoryItems
      if (total > 0) {
        toast.success(`Imported ${total} item${total === 1 ? '' : 's'} from Brewfather`)
      } else if (skipped > 0) {
        toast.info('Everything in those files was already imported — nothing duplicated')
      } else {
        toast.warning('Nothing was imported')
      }
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const onClear = () => {
    setPlan(null)
    setResult(null)
  }

  return (
    <div className="tap-card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-lg font-semibold">Coming from Brewfather?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring your whole brewery across — recipes, batches with fermentation readings, and
          ingredient inventory. In Brewfather go to <strong>Settings → Export all data</strong> and
          drop the JSON files here. You get a preview first; nothing is written until you confirm,
          and re-importing the same export never duplicates anything.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Brewfather JSON files</span>
        <input
          type="file"
          accept=".json,application/json"
          multiple
          aria-label="Brewfather JSON files"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) onFiles(e.target.files)
            e.target.value = ''
          }}
          className="field"
        />
      </label>

      {plan && (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
          <h3 className="text-sm font-semibold">Preview — nothing imported yet</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Recipes</dt>
              <dd className="font-semibold">{plan.counts.recipes}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Batches</dt>
              <dd className="font-semibold">{plan.counts.batches}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Readings</dt>
              <dd className="font-semibold">{plan.counts.readings}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Inventory items</dt>
              <dd className="font-semibold">{plan.counts.inventoryItems}</dd>
            </div>
          </dl>
          {plan.skippedEntities > 0 && (
            <p className="text-xs text-muted-foreground">
              {plan.skippedEntities} entit{plan.skippedEntities === 1 ? 'y' : 'ies'} could not be
              mapped and will be skipped — see warnings.
            </p>
          )}
          {plan.warnings.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">
                {plan.warnings.length} warning{plan.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-muted-foreground">
                {[...new Set(plan.warnings)].map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || totalPlanned === 0}
              onClick={onImport}
            >
              Import {totalPlanned} item{totalPlanned === 1 ? '' : 's'}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onClear}>
              Clear
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-3 text-sm">
          <h3 className="text-sm font-semibold">Import complete</h3>
          <p>
            Imported {result.imported.recipes} recipe{result.imported.recipes === 1 ? '' : 's'},{' '}
            {result.imported.batches} batch{result.imported.batches === 1 ? '' : 'es'},{' '}
            {result.imported.readings} reading{result.imported.readings === 1 ? '' : 's'},{' '}
            {result.imported.inventoryItems} inventory item
            {result.imported.inventoryItems === 1 ? '' : 's'}.
          </p>
          {result.skippedExisting.recipes +
            result.skippedExisting.batches +
            result.skippedExisting.readings +
            result.skippedExisting.inventoryItems >
            0 && (
            <p className="text-xs text-muted-foreground">
              Skipped{' '}
              {result.skippedExisting.recipes +
                result.skippedExisting.batches +
                result.skippedExisting.readings +
                result.skippedExisting.inventoryItems}{' '}
              row(s) already imported earlier — nothing was duplicated or overwritten.
            </p>
          )}
          {result.warnings.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">
                {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-muted-foreground">
                {[...new Set(result.warnings)].map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
