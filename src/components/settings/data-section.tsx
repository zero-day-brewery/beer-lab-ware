'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { backupService } from '@/lib/db/backup'
import { parseAndGuardDump } from '@/lib/db/import-guard'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { buildComposedBackup } from '@/lib/storage/backup-run'
import { applyLocalSnapshot, type LocalStateSnapshot } from '@/lib/storage/local-state'

function summarize(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${name}`)
  return parts.length > 0 ? parts.join(', ') : 'empty'
}

function downloadDump(dump: unknown): void {
  const body = JSON.stringify(dump, null, 2)
  const blob = new Blob([body], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `beer-lab-ware-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function DataSection() {
  const [busy, setBusy] = useState(false)

  const onExport = async () => {
    setBusy(true)
    try {
      const composed = await buildComposedBackup()
      const body = JSON.stringify(composed, null, 2)
      const blob = new Blob([body], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `beer-lab-ware-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      await appMetaRepo.setBackupRecord({
        lastBackupAt: new Date().toISOString(),
        method: 'download',
        bytes: blob.size,
        rowCounts: composed.meta.rowCounts,
        schemaVersion: 1,
      })
      toast.success('Exported backup JSON')
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const onImport = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const guard = parseAndGuardDump(text)
      if (!guard.ok) {
        toast.error(`Import blocked: ${guard.message}`)
        return
      }
      // Back up current data FIRST (one dump serves the summary + the safety copy).
      const current = await backupService.dump()
      const proceed = confirm(
        `This REPLACES all local data.\n\nCurrent: ${summarize(current.meta.rowCounts)}\nImporting: ${summarize(guard.summary)}\n\nOK will back up your current data first, then import.`,
      )
      if (!proceed) return
      downloadDump(current) // back up current data first
      await backupService.restore(guard.dump)
      // Restore the fermenter board if the file carried a composed snapshot (v7+).
      const local = (guard.dump as { local?: unknown }).local
      if (local && typeof local === 'object' && 'keys' in local) {
        applyLocalSnapshot(local as LocalStateSnapshot)
      }
      toast.success('Imported backup — all data replaced')
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const onWipe = async () => {
    if (!confirm('Wipe ALL local data? This cannot be undone.')) return
    if (!confirm('Are you absolutely sure?')) return
    setBusy(true)
    try {
      await backupService.wipe()
      // Reset the freshness chip so it can't lie ("backed up 2 min ago") about
      // data that no longer exists. The dir-handle folder pref survives (device pref).
      await appMetaRepo.clearBackupRecord()
      // Dexie is not the whole store: the AI companion config (brew-companion —
      // may hold a plaintext cloud API key) and the fermenter board
      // (brew-system-flow) live in localStorage. A "Wipe ALL data" must erase
      // them too. brew-theme is cosmetic and intentionally left.
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('brew-companion')
        localStorage.removeItem('brew-system-flow')
      }
      toast.success('All data wiped')
    } catch (err) {
      toast.error(`Wipe failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="tap-card flex flex-col gap-3 p-5">
      <h2 className="text-lg font-semibold">Data</h2>
      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="btn-ghost disabled:opacity-50"
        >
          Export backup (JSON)
        </button>

        <label className="flex w-full flex-col gap-1">
          <span className="text-sm">Import JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import JSON"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
            }}
            className="field"
          />
        </label>

        <button
          type="button"
          onClick={onWipe}
          disabled={busy}
          className="btn-ghost danger disabled:opacity-50"
        >
          Wipe ALL data
        </button>
      </div>
    </section>
  )
}
