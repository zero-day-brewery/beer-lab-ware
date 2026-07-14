'use client'
import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { db } from '@/lib/db/schema'
import { reportDbError } from '@/lib/diagnostics/error-log'

interface InventoryState {
  items: InventoryItem[]
  isLoading: boolean
  setItems: (items: InventoryItem[]) => void
}

const useInventoryStoreInternal = create<InventoryState>((set) => ({
  items: [],
  isLoading: true,
  setItems: (items) => set({ items, isLoading: false }),
}))

let subscription: { unsubscribe: () => void } | null = null

function ensureSubscription() {
  if (subscription) return
  subscription = liveQuery(() =>
    db.inventoryItems.orderBy('updatedAt').reverse().toArray(),
  ).subscribe({
    next: (items) => useInventoryStoreInternal.getState().setItems(items as InventoryItem[]),
    error: (e) => reportDbError('inventory', e),
  })
}

export function useInventoryStore(): InventoryState {
  useEffect(() => {
    ensureSubscription()
  }, [])
  return useInventoryStoreInternal()
}
