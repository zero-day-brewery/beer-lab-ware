'use client'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  applyRememberedLinks,
  buildDeductionPlan,
  type DeductionLine,
  withMatch,
} from '@/lib/brewing/inventory/deduction'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { stockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { reportDbError } from '@/lib/diagnostics/error-log'
import { useInventoryStore } from '@/stores/inventory-store'

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

const STATUS_BADGE: Record<DeductionLine['status'], { cls: string; label: string } | null> = {
  ok: null,
  short: { cls: 'warn', label: 'short' },
  mismatch: { cls: 'warn', label: 'unit mismatch' },
  unmatched: { cls: 'info', label: 'unmatched' },
}

const isDeductible = (l: DeductionLine): boolean => l.status === 'ok' || l.status === 'short'

/** Live-query the brew-deduct transactions already recorded for this batch. */
function useBatchDeductions(batchId: string): StockTransaction[] {
  const [rows, setRows] = useState<StockTransaction[]>([])
  useEffect(() => {
    const sub = liveQuery(() => stockTransactionsRepo.listByBatch(batchId)).subscribe({
      next: (r) => setRows(r.filter((t) => t.reason === 'brew-deduct')),
      error: (e) => reportDbError('batch-deductions', e),
    })
    return () => sub.unsubscribe()
  }, [batchId])
  return rows
}

/** Best-effort: stamp the chosen inventory ids back onto the live recipe. */
async function persistRememberedLinks(batch: Batch, lines: DeductionLine[]): Promise<void> {
  if (!batch.recipeId) return
  try {
    const recipe = await recipeRepo.get(batch.recipeId)
    if (!recipe) return // recipe deleted — remembered link is a convenience, skip
    const { recipe: next, changed } = applyRememberedLinks(recipe, lines)
    if (changed) await recipeRepo.save(next)
  } catch (err) {
    // Never let a write-back failure block a completed deduction.
    console.error('remembered-link write-back failed', err)
  }
}

/**
 * Read-only "already deducted" view — shown when this batch already has
 * brew-deduct transactions, blocking a second deduction (idempotency).
 */
function AlreadyDeducted({ rows, items }: { rows: StockTransaction[]; items: InventoryItem[] }) {
  const nameFor = (id: string) => items.find((i) => i.id === id)?.name ?? id
  return (
    <div className="flex flex-col gap-2">
      <span className="mini-alert go self-start">✓ Already deducted</span>
      <p className="text-xs text-muted-foreground">
        These stock movements were recorded for this brew. Re-deduction is blocked to keep the
        ledger honest.
      </p>
      <table className="sheet-table ferment-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Item</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.at).toLocaleString()}</td>
              <td>{nameFor(t.inventoryItemId)}</td>
              <td>
                <span className="mini-alert warn">
                  {fmtQty(t.delta)} {t.unit}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Shared Deduction Review modal (Logbook + guided runner). Matches a recipe's
 * ingredients to inventory (remembered link → name+kind → manual pick), converts
 * units safely (mismatches flagged, never guessed), and on confirm writes
 * `brew-deduct` transactions through the atomic ledger. A per-batch guard blocks
 * double-deduction; mismatch/unmatched lines are surfaced, never silently lost.
 */
export function DeductionReview({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const { items } = useInventoryStore()
  const priorDeducts = useBatchDeductions(batch.id)
  const alreadyDeducted = priorDeducts.length > 0

  const plan = useMemo(() => buildDeductionPlan({ batch, items }), [batch, items])

  // Per-line overrides: index → chosen inventory item id ('' clears the match).
  const [selection, setSelection] = useState<Record<number, string>>({})
  const [include, setInclude] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)

  const effective: DeductionLine[] = useMemo(
    () =>
      plan.map((line, i) => {
        const sel = selection[i]
        if (sel === undefined) return line
        const chosen = sel === '' ? null : (items.find((it) => it.id === sel) ?? null)
        return withMatch(line, chosen)
      }),
    [plan, selection, items],
  )

  const included = effective.filter((l, i) => isDeductible(l) && (include[i] ?? true))
  const includedCount = included.length

  async function onConfirm() {
    if (alreadyDeducted || busy) return
    setBusy(true)
    try {
      const toDeduct = effective.filter((l, i) => isDeductible(l) && (include[i] ?? true))
      // Build every movement up front, then commit them in ONE atomic transaction.
      // The per-batch idempotency guard now lives INSIDE that tx (closing the
      // TOCTOU window the per-line loop had) and a throw on any line rolls the
      // whole deduction back — no partial deduct can survive a mid-batch failure.
      const changes = toDeduct
        .filter((l) => l.matchedItemId != null && l.draw != null)
        .map((l) => ({
          inventoryItemId: l.matchedItemId as string,
          delta: -(l.draw as number),
          reason: 'brew-deduct' as const,
          batchId: batch.id,
          recipeUseRef: l.recipeUseRef,
        }))
      await stockTransactionsRepo.applyStockChanges(changes, { batchId: batch.id })
      // Remembered-link write-back is a best-effort convenience — fine outside the tx.
      await persistRememberedLinks(batch, toDeduct)
      toast.success(
        `Deducted ${changes.length} ingredient${changes.length === 1 ? '' : 's'} from inventory.`,
      )
      onClose()
    } catch (err) {
      toast.error(`Deduction failed: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <div
      className="water-overlay"
      style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
    >
      <div className="water-modal tap-card">
        <header className="water-modal-head">
          <h3 className="text-base font-semibold">
            🍺 Deduct ingredients — #{batch.batchNo} {batch.name}
          </h3>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close deduction review"
          >
            ✕
          </button>
        </header>

        {plan.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This batch has no recipe ingredients to deduct.
          </p>
        ) : alreadyDeducted ? (
          <AlreadyDeducted rows={priorDeducts} items={items} />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Review each line, then confirm. Unit mismatches and unmatched lines are skipped —
              resolve them by picking an inventory item.
            </p>

            <div className="report-scroll">
              <table className="sheet-table ferment-table">
                <thead>
                  <tr>
                    <th>
                      <span className="sr-only">Include</span>
                    </th>
                    <th>Ingredient</th>
                    <th>Recipe</th>
                    <th>Inventory item</th>
                    <th>Draw</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {effective.map((l, i) => {
                    const badge = STATUS_BADGE[l.status]
                    const deductible = isDeductible(l)
                    return (
                      <tr key={`${l.line}:${l.ingredientId}`}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!deductible}
                            checked={deductible && (include[i] ?? true)}
                            onChange={(e) => setInclude((m) => ({ ...m, [i]: e.target.checked }))}
                            aria-label={`Include ${l.name}`}
                          />
                        </td>
                        <td>
                          {l.name}
                          {badge && (
                            <span className={`mini-alert ${badge.cls} ml-1`}>{badge.label}</span>
                          )}
                        </td>
                        <td className="font-mono">
                          {fmtQty(l.recipeQty)} {l.recipeUnit}
                        </td>
                        <td>
                          <select
                            className="field"
                            value={l.matchedItemId ?? ''}
                            onChange={(e) => setSelection((m) => ({ ...m, [i]: e.target.value }))}
                            aria-label={`Inventory item for ${l.name}`}
                          >
                            <option value="">— none —</option>
                            {l.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({fmtQty(c.amount)} {c.amountUnit})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="font-mono">
                          {l.draw == null ? '—' : `${fmtQty(l.draw)} ${l.drawUnit}`}
                        </td>
                        <td className="font-mono">
                          {l.resultingBalance == null
                            ? '—'
                            : `${fmtQty(l.resultingBalance)} ${l.drawUnit}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || includedCount === 0}
                onClick={onConfirm}
              >
                {busy
                  ? 'Deducting…'
                  : `Deduct ${includedCount} ingredient${includedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
