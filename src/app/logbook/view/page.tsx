import { Suspense } from 'react'
import { BatchSheetView } from '@/components/logbook/batch-sheet-view'

// Static route; the batch id is read client-side from ?id= (export-safe).
export default function LogbookViewPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading batch…</p>}
    >
      <BatchSheetView />
    </Suspense>
  )
}
