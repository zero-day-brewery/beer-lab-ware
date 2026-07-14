import { Suspense } from 'react'
import { LogbookView } from '@/components/logbook/logbook-view'

// Static route; the tab views stream from the liveQuery store client-side (export-safe).
export default function LogbookPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading logbook…</p>}
    >
      <LogbookView />
    </Suspense>
  )
}
