// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupSettingsCard } from '@/components/durability/backup-settings-card'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { db } from '@/lib/db/schema'

describe('BackupSettingsCard', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
  })
  afterEach(async () => {
    await db.appMeta.clear()
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
  })

  it('shows "No backup yet" (critical) when nothing is recorded', async () => {
    render(<BackupSettingsCard />)
    await waitFor(() =>
      expect(screen.getByTestId('backup-age-chip')).toHaveTextContent('No backup yet'),
    )
    expect(screen.getByTestId('backup-age-chip')).toHaveAttribute('data-freshness', 'critical')
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeInTheDocument()
  })

  it('shows the stale chip copy for a 7–30 day old backup', async () => {
    await appMetaRepo.setBackupRecord({
      lastBackupAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      method: 'download',
      bytes: 1,
      rowCounts: {},
      schemaVersion: 1,
    })
    render(<BackupSettingsCard />)
    await waitFor(() =>
      expect(screen.getByTestId('backup-age-chip')).toHaveAttribute('data-freshness', 'stale'),
    )
    expect(screen.getByTestId('backup-age-chip')).toHaveTextContent("It's been 10 days — back up")
  })

  it('shows rotation count + Change folder when a folder is configured (granted)', async () => {
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve()
    await appMetaRepo.setDirHandle({
      kind: 'directory',
      name: 'brew-backups',
    } as unknown as FileSystemDirectoryHandle) // method-free → structured-cloneable in fake-indexeddb
    render(<BackupSettingsCard />)
    expect(await screen.findByRole('button', { name: 'Change folder' })).toBeInTheDocument()
    expect(screen.getByTestId('backup-rotation')).toHaveTextContent('Keeps the last 10 backups')
  })
})
