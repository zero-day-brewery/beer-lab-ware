// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSection } from '@/components/settings/data-section'
import { backupService } from '@/lib/db/backup'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('DataSection durability wiring', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
    localStorage.clear()
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(async () => {
    await db.appMeta.clear()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  // Folded from the pre-existing data-section.test.tsx render smoke (keep coverage).
  it('renders Export, Import, Wipe controls', () => {
    render(<DataSection />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/import json/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wipe/i })).toBeInTheDocument()
  })

  it('records a download BackupRecord on export', async () => {
    localStorage.setItem('brew-system-flow', '{"fermenters":[]}')
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Export backup (JSON)' }))
    await waitFor(async () =>
      expect((await appMetaRepo.getBackupRecord())?.method).toBe('download'),
    )
  })

  it('clears the BackupRecord after a wipe', async () => {
    await appMetaRepo.setBackupRecord({
      lastBackupAt: new Date().toISOString(),
      method: 'download',
      bytes: 1,
      rowCounts: {},
      schemaVersion: 1,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Wipe ALL data' }))
    await waitFor(async () => expect(await appMetaRepo.getBackupRecord()).toBeNull())
  })

  it('removes the AI secret + fermenter board from localStorage on wipe', async () => {
    // brew-companion may hold a plaintext cloud AI API key; brew-system-flow is
    // the fermenter board (user data). Both must not survive "Wipe ALL data".
    localStorage.setItem('brew-companion', '{"apiKey":"sk-secret-should-be-wiped"}')
    localStorage.setItem('brew-system-flow', '{"fermenters":[]}')
    localStorage.setItem('brew-theme', 'matrix') // cosmetic — must be preserved
    vi.spyOn(window, 'confirm').mockReturnValue(true) // two confirm() dialogs
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Wipe ALL data' }))
    await waitFor(() => expect(localStorage.getItem('brew-companion')).toBeNull())
    expect(localStorage.getItem('brew-system-flow')).toBeNull()
    expect(localStorage.getItem('brew-theme')).toBe('matrix')
  })

  it('rejects a too-new dump: toasts, does NOT restore', async () => {
    const restore = vi.spyOn(backupService, 'restore')
    const { toast } = await import('sonner')
    render(<DataSection />)
    const future = JSON.stringify({
      version: 999,
      exportedAt: new Date().toISOString(),
      tables: { recipes: [] },
    })
    const file = new File([future], 'backup.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(future) })
    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [file] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(restore).not.toHaveBeenCalled()
  })

  it('rejects non-JSON: toasts, does NOT restore', async () => {
    const restore = vi.spyOn(backupService, 'restore')
    const { toast } = await import('sonner')
    render(<DataSection />)
    const bad = '{ not json'
    const file = new File([bad], 'backup.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(bad) })
    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [file] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(restore).not.toHaveBeenCalled()
  })

  it('cancelling the replace-confirm aborts the import (no restore)', async () => {
    const restore = vi.spyOn(backupService, 'restore')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DataSection />)
    const ok = JSON.stringify({
      version: 7,
      exportedAt: new Date().toISOString(),
      meta: { dumpVersion: 7, dbVersion: 8, rowCounts: {}, schemaVersion: 1 },
      tables: {
        recipes: [],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
        inventoryItems: [],
        gearItems: [],
        waterProfiles: [],
        batches: [],
        brewSessions: [],
        brewTimers: [],
        readings: [],
        stockTransactions: [],
        seedTombstones: [],
      },
    })
    const file = new File([ok], 'backup.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(ok) })
    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [file] } })
    await new Promise((r) => setTimeout(r, 20))
    expect(restore).not.toHaveBeenCalled()
  })

  it('applies the fermenter board from a composed import (v7 local snapshot)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true) // guarded import now confirms replace
    render(<DataSection />)
    const composed = {
      version: 7,
      exportedAt: new Date().toISOString(),
      meta: { dumpVersion: 7, dbVersion: 8, rowCounts: {}, schemaVersion: 1 },
      tables: {
        recipes: [],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
        inventoryItems: [],
        gearItems: [],
        waterProfiles: [],
        batches: [],
        brewSessions: [],
        brewTimers: [],
        readings: [],
        stockTransactions: [],
        seedTombstones: [],
      },
      app: { version: '0.0.0-dev', sha: 'local', builtAt: '' },
      local: { keys: { 'brew-system-flow': 'BOARD' }, capturedAt: '2026-07-07T00:00:00.000Z' },
    }
    const body = JSON.stringify(composed)
    const file = new File([body], 'backup.json', { type: 'application/json' })
    // jsdom File.text() is flaky across versions; stub it (established repo pattern,
    // see tests/unit/components/import-view.test.tsx).
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) })
    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [file] } })
    await waitFor(() => expect(localStorage.getItem('brew-system-flow')).toBe('BOARD'))
  })
})
