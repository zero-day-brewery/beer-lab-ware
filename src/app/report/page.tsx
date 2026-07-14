'use client'
import { useMemo } from 'react'
import { ReportActions } from '@/components/report/report-actions'
import { ReportView } from '@/components/report/report-view'
import { buildInventoryReport } from '@/lib/brewing/report/inventory-report'
import { useGearStore } from '@/stores/gear-store'
import { useInventoryStore } from '@/stores/inventory-store'

export default function ReportPage() {
  const gear = useGearStore()
  const inventory = useInventoryStore()

  const report = useMemo(
    () =>
      buildInventoryReport({
        gear: gear.items,
        inventory: inventory.items,
        generatedAt: new Date(),
      }),
    [gear.items, inventory.items],
  )

  if (gear.isLoading || inventory.isLoading) {
    return <p className="report-empty">Loading inventory…</p>
  }

  return (
    <div className="report-page">
      <ReportActions report={report} />
      <ReportView report={report} />
    </div>
  )
}
