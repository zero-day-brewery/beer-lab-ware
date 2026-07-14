'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  getPersistenceState,
  getStorageEstimate,
  type PersistenceState,
  requestPersistence,
  type StorageEstimate,
} from '@/lib/storage/durability'

export interface UseDurability {
  state: PersistenceState
  estimate: StorageEstimate | null
  requestPersist: () => Promise<void>
}

export function useDurability(): UseDurability {
  const [state, setState] = useState<PersistenceState>('unsupported')
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)

  const refresh = useCallback(async () => {
    setState(await getPersistenceState())
    setEstimate(await getStorageEstimate())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const requestPersist = useCallback(async () => {
    await requestPersistence()
    await refresh()
  }, [refresh])

  return { state, estimate, requestPersist }
}
