'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import type { InventoryReport } from '@/lib/brewing/report/inventory-report'
import { downloadInventoryWorkbook } from '@/lib/report/xlsx'

export function ReportActions({ report }: { report: InventoryReport }) {
  const [busy, setBusy] = useState(false)

  async function onExcel() {
    setBusy(true)
    try {
      await downloadInventoryWorkbook(report)
      toast.success('Excel report downloaded')
    } catch (err) {
      console.error(err)
      toast.error('Could not generate Excel report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="report-actions print:hidden">
      <button type="button" className="btn-primary" onClick={onExcel} disabled={busy}>
        {busy ? 'Generating…' : 'Download Excel'}
      </button>
      <button type="button" className="btn-ghost" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
    </div>
  )
}
