import { toast } from 'sonner'
import { db } from '@/lib/db/schema'
import { APP_VERSION } from '@/lib/version'

export interface DiagnosticEntry {
  scope: string
  message: string
  stack?: string
  at: string
}

export interface Diagnostics {
  appVersion: string
  verno: number | null
  tableCounts?: Record<string, number>
  storageEstimate?: unknown
  ring: DiagnosticEntry[]
  userAgent: string
}

const RING_MAX = 50
const ring: DiagnosticEntry[] = []

function toEntry(scope: string, err: unknown): DiagnosticEntry {
  const asError = err instanceof Error ? err : new Error(String(err))
  return {
    scope,
    message: asError.message,
    stack: asError.stack,
    at: new Date().toISOString(),
  }
}

export function recordError(scope: string, err: unknown): void {
  ring.push(toEntry(scope, err))
  if (ring.length > RING_MAX) ring.shift()
}

function friendlyMessage(scope: string): string {
  return `Couldn't read your brewery data (${scope}). Your saved data is safe — try reloading. If it keeps happening, export a backup from Settings.`
}

export function reportDbError(scope: string, err: unknown): void {
  recordError(scope, err) // every error is recorded per-call (ring is the audit trail)
  // A mid-session DB failure fans out to 5-7 store subscriptions at once. Give the
  // toast a stable id so sonner coalesces the burst into ONE visible toast (repeat
  // calls update the same toast) instead of stacking 5-7 identical ones.
  toast.error(friendlyMessage(scope), { id: 'db-error' })
}

export function getDiagnostics(): Diagnostics {
  // Sync subset by design: tableCounts + storageEstimate are optional and gathered
  // by E3's diagnostics panel (async). Keeping this synchronous lets the error
  // boundaries + CopyDiagnosticsButton call it safely during a render/crash path.
  return {
    appVersion: APP_VERSION,
    verno: db.isOpen() ? db.verno : null,
    ring: [...ring],
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  }
}

let hooksInstalled = false
export function installGlobalErrorHooks(): void {
  if (hooksInstalled || typeof window === 'undefined') return
  hooksInstalled = true
  window.addEventListener('error', (e) => recordError('window.error', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => recordError('unhandledrejection', e.reason))
}

export function clearDiagnosticsRing(): void {
  ring.length = 0
}
