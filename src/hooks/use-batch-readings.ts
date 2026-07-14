'use client'
import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import type { Reading } from '@/lib/brewing/types/reading'
import { readingsRepo } from '@/lib/db/repos/readings'
import { reportDbError } from '@/lib/diagnostics/error-log'

/** Live-query one batch's readings (sorted by time). Consolidates the former
 *  per-view useReadings/useBatchReadings/useFermReadings. A null/undefined
 *  batchId yields an empty list and no subscription. Raw liveQuery().subscribe()
 *  per the repo reactivity convention. */
export function useBatchReadings(batchId: string | null | undefined): Reading[] {
  const [readings, setReadings] = useState<Reading[]>([])
  useEffect(() => {
    if (!batchId) {
      setReadings([])
      return
    }
    const sub = liveQuery(() => readingsRepo.listByBatch(batchId)).subscribe({
      next: (rows) => setReadings(rows),
      error: (e) => reportDbError('readings', e),
    })
    return () => sub.unsubscribe()
  }, [batchId])
  return readings
}
