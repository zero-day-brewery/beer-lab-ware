'use client'
import { useEffect, useMemo, useState } from 'react'
import { useDisplayUnits } from '@/hooks/use-display-units'
import {
  type BatchCostLine,
  computeBatchCost,
  costPerDisplayVolume,
} from '@/lib/brewing/report/batch-cost'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { inventoryRepo } from '@/lib/db/repos/inventory'
import { stockTransactionsRepo } from '@/lib/db/repos/stock-transactions'

/**
 * Read-only per-batch COGS — computed live from the batch's ledger txns ×
 * inventory prices (`computeBatchCost`). Pure read-model: nothing here writes.
 * Money is explicit USD (`pricePerUnit_USD`); unpriced items are listed but
 * never estimated. Cost-per-volume follows the display-units preference
 * ($/L metric, $/gal imperial).
 */

const usd = (n: number): string => `$${n.toFixed(2)}`
/** Trim float noise on ledger quantities ("4.999999" → "5"). */
const fmtQty = (n: number): string => String(Number(n.toFixed(3)))

function lineKey(l: BatchCostLine): string {
  return `${l.kind}:${l.itemName}:${l.unit}:${l.qty}`
}

export function BatchCostSection({ batch }: { batch: Batch }) {
  const units = useDisplayUnits()
  const [data, setData] = useState<{
    txns: StockTransaction[]
    items: InventoryItem[]
  } | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([stockTransactionsRepo.listByBatch(batch.id), inventoryRepo.list()])
      .then(([txns, items]) => {
        if (alive) setData({ txns, items })
      })
      .catch((err) => {
        console.error('batch cost load failed', err)
        if (alive) setData({ txns: [], items: [] })
      })
    return () => {
      alive = false
    }
  }, [batch.id])

  const cost = useMemo(
    () => (data ? computeBatchCost({ batch, txns: data.txns, items: data.items }) : null),
    [data, batch],
  )

  if (!cost) return null

  const perVol = costPerDisplayVolume(cost, units)
  const unpriced = cost.unknownLines.length

  return (
    <section className="logsheet-section">
      <h2 className="logsheet-section-title">Batch Cost</h2>

      {cost.lines.length === 0 ? (
        <p className="logsheet-notes">
          No ingredient movements are linked to this batch yet — use "Deduct ingredients" (and set
          prices in Inventory) to build a cost sheet.
        </p>
      ) : (
        <>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit price (USD)</th>
                <th>Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {cost.lines.map((l) => (
                <tr key={lineKey(l)}>
                  <td>{l.itemName}</td>
                  <td>
                    {fmtQty(l.qty)} {l.unit}
                  </td>
                  <td>{l.unitPrice === null ? '—' : usd(l.unitPrice)}</td>
                  <td className="sheet-actual">{l.cost === null ? '—' : usd(l.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="logsheet-notes" data-testid="batch-cost-summary">
            <strong>Known cost:</strong> {usd(cost.knownCost)} {cost.currency}
            {perVol && (
              <>
                {' · '}
                <strong>
                  {usd(perVol.value)} / {perVol.volumeUnit}
                </strong>
              </>
            )}
          </p>

          {unpriced > 0 && (
            <p className="logsheet-notes">
              {unpriced} item{unpriced === 1 ? '' : 's'} unpriced — excluded from the total. Add
              prices in Inventory to complete the cost sheet.
            </p>
          )}
        </>
      )}
    </section>
  )
}
