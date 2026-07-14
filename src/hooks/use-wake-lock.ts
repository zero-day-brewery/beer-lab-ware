'use client'
import { useEffect } from 'react'

interface WakeLockSentinelLike {
  release: () => Promise<void>
}
interface WakeLockNav {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

/** Holds navigator.wakeLock while `active`; re-acquires on visibilitychange. No-ops if unsupported. */
export function useWakeLock(active: boolean): { supported: boolean } {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as WakeLockNav | undefined
  const supported = !!nav?.wakeLock
  useEffect(() => {
    if (!supported || !active || !nav?.wakeLock) return
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        sentinel = (await nav.wakeLock?.request('screen')) ?? null
      } catch {
        /* user-gesture / policy denial — acceptable, fall through */
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active, supported, nav])
  return { supported }
}
