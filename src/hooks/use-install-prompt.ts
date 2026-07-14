'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  getInstallState,
  type InstallState,
  isInstallSuppressed,
  markInstallDismissed,
  promptInstall as promptInstallImpl,
  stashInstallPrompt,
} from '@/lib/storage/install'

export interface UseInstallPrompt {
  installState: InstallState
  promptInstall: () => Promise<boolean>
  dismiss: () => void
}

export function useInstallPrompt(): UseInstallPrompt {
  const [installState, setInstallState] = useState<InstallState>('unavailable')

  useEffect(() => {
    stashInstallPrompt()
    // 'installed' is a fact and passes through; the nudge states
    // ('installable' / 'manual-safari') obey the engagement + dismiss-cooldown
    // suppression policy (spec E1.6) so the card can't appear cold or during cooldown.
    const compute = () => {
      const base = getInstallState()
      setInstallState(base !== 'installed' && isInstallSuppressed() ? 'unavailable' : base)
    }
    compute()
    const onChange = () => compute()
    window.addEventListener('appinstalled', onChange)
    window.addEventListener('beforeinstallprompt', onChange)
    return () => {
      window.removeEventListener('appinstalled', onChange)
      window.removeEventListener('beforeinstallprompt', onChange)
    }
  }, [])

  const dismiss = useCallback(() => {
    markInstallDismissed() // starts the ~30-day cooldown (read back by isInstallSuppressed)
    setInstallState('unavailable')
  }, [])

  return { installState, promptInstall: promptInstallImpl, dismiss }
}
