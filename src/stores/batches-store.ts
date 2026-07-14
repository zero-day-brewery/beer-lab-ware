'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Batch } from '@/lib/brewing/types/batch'
import { db } from '@/lib/db/schema'
import { reportDbError } from '@/lib/diagnostics/error-log'

interface BatchesState {
  batches: Batch[]
  isLoading: boolean
  setBatches: (batches: Batch[]) => void
}

const useBatchesStoreInternal = create<BatchesState>((set) => ({
  batches: [],
  isLoading: true,
  setBatches: (batches) => set({ batches, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null

function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() => db.batches.orderBy('updatedAt').reverse().toArray()).subscribe({
    next: (batches) => useBatchesStoreInternal.getState().setBatches(batches as Batch[]),
    error: (e) => reportDbError('batches', e),
  })
}

export function useBatchesStore(): BatchesState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useBatchesStoreInternal()
}
