// src/components/shell/durability-init.tsx
'use client'
import { useEffect } from 'react'
import { db } from '@/lib/db/schema'
import { maybeBackupOnLaunch } from '@/lib/storage/backup-run'
import { getStorageEstimate, requestPersistence } from '@/lib/storage/durability'
import { recordSession } from '@/lib/storage/install'

/**
 * Boot-time durability. Advances the once-per-session counter (gates the install
 * nudge — spec E1.6), requests persistence (idempotent), warms the storage
 * estimate (surfaced by useDurability in the badge/warning), then runs the
 * time-based launch staleness check. Errors are swallowed with an optional
 * console note — the E2 error-log ring buffer + reportDbError are NOT wired
 * here (that is E2). During the E1-only window the app behaves as today.
 * This is the ONLY always-mounted place the session counter can advance (the
 * install card only mounts when Settings is open), so recordSession lives here.
 */
export function DurabilityInit() {
  useEffect(() => {
    recordSession() // sync, once-per-launch; guarded by sessionStorage inside install.ts
    let cancelled = false
    const run = async () => {
      try {
        await db.open()
        await requestPersistence()
        await getStorageEstimate()
        await maybeBackupOnLaunch()
      } catch (err) {
        if (!cancelled) console.warn('durability-init skipped:', err)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
