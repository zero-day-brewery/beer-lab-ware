export type PersistenceState = 'persisted' | 'transient' | 'unsupported'

function hasStorage(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage
}

export function isPersistenceSupported(): boolean {
  return hasStorage() && typeof navigator.storage.persist === 'function'
}

export async function getPersistenceState(): Promise<PersistenceState> {
  if (!isPersistenceSupported()) return 'unsupported'
  return (await navigator.storage.persisted()) ? 'persisted' : 'transient'
}

export async function requestPersistence(): Promise<boolean> {
  if (!isPersistenceSupported()) return false
  return navigator.storage.persist()
}

export interface StorageEstimate {
  usageBytes: number
  quotaBytes: number
  percentUsed: number
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!hasStorage() || typeof navigator.storage.estimate !== 'function') return null
  const est = await navigator.storage.estimate()
  const usageBytes = est.usage ?? 0
  const quotaBytes = est.quota ?? 0
  const percentUsed = quotaBytes > 0 ? usageBytes / quotaBytes : 0
  return { usageBytes, quotaBytes, percentUsed }
}
