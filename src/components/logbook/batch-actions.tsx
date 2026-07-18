'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDisplayUnits } from '@/hooks/use-display-units'
import { computeBatchCost } from '@/lib/brewing/report/batch-cost'
import { buildBatchRecord } from '@/lib/brewing/report/batch-record'
import { readingsCsvFilename, readingsToCsv } from '@/lib/brewing/report/readings-csv'
import type { Batch } from '@/lib/brewing/types/batch'
import { inventoryRepo } from '@/lib/db/repos/inventory'
import { readingsRepo } from '@/lib/db/repos/readings'
import { stockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { downloadBatchWorkbook } from '@/lib/report/batch-xlsx'
import { downloadBlob } from '@/lib/report/download'

/**
 * Batch-sheet export actions — Print (the print stylesheet turns the sheet
 * into a clean record), the completed-batch Excel record (metadata, timeline,
 * readings, COGS when priced), and the per-batch readings CSV. Repos are read
 * at click time so exports always reflect current data.
 */
export function BatchActions({ batch }: { batch: Batch }) {
  const units = useDisplayUnits()
  const [busy, setBusy] = useState(false)

  async function onExportRecord() {
    setBusy(true)
    try {
      const [readings, txns, items] = await Promise.all([
        readingsRepo.listByBatch(batch.id),
        stockTransactionsRepo.listByBatch(batch.id),
        inventoryRepo.list(),
      ])
      const cost = computeBatchCost({ batch, txns, items })
      const record = buildBatchRecord({ batch, readings, cost, units, generatedAt: new Date() })
      await downloadBatchWorkbook(record)
      toast.success('Batch record downloaded')
    } catch (err) {
      console.error(err)
      toast.error('Could not generate the batch record')
    } finally {
      setBusy(false)
    }
  }

  async function onReadingsCsv() {
    try {
      const readings = await readingsRepo.listByBatch(batch.id)
      const blob = new Blob([readingsToCsv(readings)], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, readingsCsvFilename(batch))
      toast.success('Readings CSV downloaded')
    } catch (err) {
      console.error(err)
      toast.error('Could not export the readings CSV')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" className="btn-ghost" onClick={() => window.print()}>
        Print
      </button>
      <button type="button" className="btn-ghost" onClick={onExportRecord} disabled={busy}>
        {busy ? 'Generating…' : 'Batch record (.xlsx)'}
      </button>
      <button type="button" className="btn-ghost" onClick={onReadingsCsv}>
        Readings CSV
      </button>
    </div>
  )
}
