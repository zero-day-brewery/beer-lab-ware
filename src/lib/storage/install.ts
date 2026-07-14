export type InstallState = 'installed' | 'installable' | 'manual-safari' | 'unavailable'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let stashedPrompt: BeforeInstallPromptEvent | null = null

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mm = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true
  return mm || iosStandalone
}

export function getInstallState(): InstallState {
  if (typeof window === 'undefined') return 'unavailable'
  if (isStandalone()) return 'installed'
  if (stashedPrompt !== null) return 'installable'
  if (isSafari()) return 'manual-safari'
  return 'unavailable'
}

export function stashInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    stashedPrompt = e as BeforeInstallPromptEvent
  })
}

export async function promptInstall(): Promise<boolean> {
  if (stashedPrompt === null) return false
  await stashedPrompt.prompt()
  const choice = await stashedPrompt.userChoice
  stashedPrompt = null
  return choice.outcome === 'accepted'
}

// ── Install-nudge suppression policy (spec E1.6) ────────────────────────────
// Pure localStorage/sessionStorage; applied by useInstallPrompt, NOT by
// getInstallState. Keeps capability detection independent of engagement/cooldown.
const SESSION_KEY = 'beer-lab-ware-session-count'
const SESSION_GUARD_KEY = 'beer-lab-ware-session-counted'
const DISMISS_KEY = 'beer-lab-ware-install-dismissed'
const DISMISS_COOLDOWN_MS = 30 * 86_400_000 // ~30 days
const ENGAGEMENT_MIN_SESSIONS = 2 // first appearance gated to the 2nd session

/** Advance the once-per-browser-session counter (called once from DurabilityInit).
 *  A sessionStorage guard makes it count once per tab session (and neutralises a
 *  StrictMode double-mount). */
export function recordSession(): void {
  if (typeof localStorage === 'undefined') return
  if (typeof sessionStorage !== 'undefined') {
    if (sessionStorage.getItem(SESSION_GUARD_KEY) === '1') return
    sessionStorage.setItem(SESSION_GUARD_KEY, '1')
  }
  const n = Number(localStorage.getItem(SESSION_KEY) ?? '0')
  localStorage.setItem(SESSION_KEY, String(Number.isFinite(n) ? n + 1 : 1))
}

/** True while the install nudge must stay hidden: before the engagement gate
 *  (2nd session) OR inside the ~30-day post-dismiss cooldown. SSR → suppressed. */
export function isInstallSuppressed(now = Date.now()): boolean {
  if (typeof localStorage === 'undefined') return true
  const sessions = Number(localStorage.getItem(SESSION_KEY) ?? '0')
  if (!(sessions >= ENGAGEMENT_MIN_SESSIONS)) return true
  const raw = localStorage.getItem(DISMISS_KEY)
  if (raw !== null) {
    const at = Number(raw)
    if (Number.isFinite(at) && now - at < DISMISS_COOLDOWN_MS) return true
  }
  return false
}

export function markInstallDismissed(now = Date.now()): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(DISMISS_KEY, String(now))
}
