import { Suspense } from 'react'
import { TrendsView } from '@/components/logbook/trends-view'

export default function LogbookTrendsPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading trends…</p>}
    >
      <TrendsView />
    </Suspense>
  )
}
