'use client'
import { useInstallPrompt } from '@/hooks/use-install-prompt'

export function InstallPwaCard() {
  const { installState, promptInstall, dismiss } = useInstallPrompt()
  if (installState === 'installed' || installState === 'unavailable') return null
  return (
    <section className="tap-card flex flex-col gap-3 p-5" data-testid="install-pwa-card">
      <h3 className="text-base font-semibold">Install app</h3>
      {installState === 'installable' ? (
        <button type="button" className="btn-ghost" onClick={() => void promptInstall()}>
          Install app
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">
          In Safari: File ▸ Add to Dock to keep your brewery safe from the 7-day purge.
        </p>
      )}
      <button type="button" className="btn-ghost text-xs" onClick={dismiss}>
        Dismiss
      </button>
    </section>
  )
}
