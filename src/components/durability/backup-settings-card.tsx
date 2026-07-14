'use client'
import type { BackupStatus, Freshness } from '@/hooks/use-backup-status'
import { useBackupStatus } from '@/hooks/use-backup-status'
import { KEEP_LAST, supportsFolderBackup } from '@/lib/storage/backup-run'

const CHIP: Record<Freshness, string> = { fresh: '🟢', stale: '🟠', critical: '🔴' }

/** Chip copy per spec E1.6: fresh → "Backed up Nd ago", stale → "It's been N days
 *  — back up", critical-never → "No backup yet", critical->30d → "No recent backup". */
function chipLabel(s: BackupStatus): string {
  if (s.ageDays === null) return 'No backup yet'
  const n = Math.floor(s.ageDays)
  if (s.freshness === 'fresh') return `Backed up ${n}d ago`
  if (s.freshness === 'stale') return `It's been ${n} days — back up`
  return 'No recent backup'
}

export function BackupSettingsCard() {
  const s = useBackupStatus()
  const folderSupported = supportsFolderBackup()
  // "Folder configured, granted" branch (spec E1.6): rotation count + Change folder.
  const showFolderControls = folderSupported && s.configured && !s.needsGesture
  return (
    <section className="tap-card flex flex-col gap-3 p-5" data-testid="backup-settings-card">
      <h3 className="text-base font-semibold">Backups</h3>
      <span className="text-sm" data-testid="backup-age-chip" data-freshness={s.freshness}>
        {CHIP[s.freshness]} {chipLabel(s)}
      </span>
      {folderSupported && !s.configured ? (
        <button type="button" className="btn-ghost" onClick={() => void s.configureFolder()}>
          Set up auto-backup folder
        </button>
      ) : null}
      {showFolderControls ? (
        <p className="text-xs text-muted-foreground" data-testid="backup-rotation">
          Keeps the last {KEEP_LAST} backups in the folder
        </p>
      ) : null}
      {s.needsGesture ? (
        <button type="button" className="btn-ghost danger" onClick={() => void s.configureFolder()}>
          Resume auto-backup
        </button>
      ) : null}
      <button type="button" className="btn-ghost" onClick={() => void s.runBackup()}>
        Back up now
      </button>
      {showFolderControls ? (
        <button type="button" className="btn-ghost" onClick={() => void s.configureFolder()}>
          Change folder
        </button>
      ) : null}
    </section>
  )
}
