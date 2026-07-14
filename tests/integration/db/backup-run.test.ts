// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { db } from '@/lib/db/schema'
import {
  KEEP_LAST,
  maybeBackupOnLaunch,
  NeedsGestureError,
  runBackup,
  STALE_DAYS,
  supportsFolderBackup,
} from '@/lib/storage/backup-run'

function grantedHandle(writes: string[], perm: PermissionState = 'granted') {
  const files = new Map<string, string>()
  return {
    kind: 'directory' as const,
    name: 'brew-backups',
    queryPermission: async () => perm,
    async getFileHandle(name: string) {
      return {
        async createWritable() {
          return {
            async write(data: string) {
              files.set(name, data)
              writes.push(name)
            },
            async close() {},
          }
        },
      }
    },
    async removeEntry(name: string) {
      files.delete(name)
    },
    async *[Symbol.asyncIterator]() {
      for (const name of files.keys()) yield [name, { kind: 'file' }] as [string, { kind: string }]
    },
  } as unknown as FileSystemDirectoryHandle
}

beforeEach(async () => {
  await db.open()
  await db.appMeta.clear()
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
})
afterEach(async () => {
  await db.appMeta.clear()
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
  vi.restoreAllMocks()
})

describe('backup-run constants + capability', () => {
  it('exports the hardcoded cadence constants', () => {
    expect(STALE_DAYS).toBe(7)
    expect(KEEP_LAST).toBe(10)
  })
  it('supportsFolderBackup is false without showDirectoryPicker', () => {
    expect(supportsFolderBackup()).toBe(false)
  })
})

describe('runBackup', () => {
  it('downloads and records method "download" when no folder is configured', async () => {
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation(
      (tag: string) =>
        (tag === 'a'
          ? ({ href: '', download: '', click } as unknown as HTMLElement)
          : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as HTMLElement,
    )
    const rec = await runBackup()
    expect(rec.method).toBe('download')
    expect(click).toHaveBeenCalledOnce()
    expect((await appMetaRepo.getBackupRecord())?.method).toBe('download')
  })

  it('throws NeedsGestureError and preserves the prior record when permission decayed', async () => {
    const prior = {
      lastBackupAt: '2020-01-01T00:00:00.000Z',
      method: 'fsa-folder' as const,
      bytes: 5,
      rowCounts: {},
      schemaVersion: 1 as const,
    }
    await appMetaRepo.setBackupRecord(prior)
    // Inject the method-bearing handle via a getDirHandle spy. Do NOT persist it
    // through appMetaRepo.setDirHandle: fake-indexeddb clones every put() with
    // Node's structuredClone, which throws DataCloneError on the handle's methods
    // (queryPermission/getFileHandle/removeEntry/asyncIterator). The spy lets
    // runBackup see a live handle while nothing round-trips through IndexedDB.
    vi.spyOn(appMetaRepo, 'getDirHandle').mockResolvedValue(grantedHandle([], 'prompt'))
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve()
    await expect(runBackup()).rejects.toBeInstanceOf(NeedsGestureError)
    expect(await appMetaRepo.getBackupRecord()).toEqual(prior) // prior record intact (real DB)
  })

  it('records the backup even when pruning fails (removeEntry rejects)', async () => {
    // The backup is already durably written; a locked/permission-denied prune
    // (removeEntry rejects) must NOT block recording it — otherwise the age chip
    // stays stale forever and, on the manual path, the rejection escapes
    // uncaught. Same getDirHandle spy pattern (no round-trip through IndexedDB).
    const existing = Array.from(
      { length: KEEP_LAST + 1 },
      (_, i) => `beer-lab-ware-backup-2020-01-${String(i + 1).padStart(2, '0')}.json`,
    )
    const handle = {
      kind: 'directory' as const,
      name: 'brew-backups',
      queryPermission: async () => 'granted' as PermissionState,
      async getFileHandle() {
        return {
          async createWritable() {
            return { async write() {}, async close() {} }
          },
        }
      },
      async removeEntry() {
        throw new DOMException('folder is locked', 'NoModificationAllowedError')
      },
      async *[Symbol.asyncIterator]() {
        for (const name of existing) yield [name, { kind: 'file' }] as [string, { kind: string }]
      },
    } as unknown as FileSystemDirectoryHandle
    vi.spyOn(appMetaRepo, 'getDirHandle').mockResolvedValue(handle)
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve()
    const rec = await runBackup()
    expect(rec.method).toBe('fsa-folder')
    expect((await appMetaRepo.getBackupRecord())?.method).toBe('fsa-folder')
  })

  it('clears a dead dir handle and re-prompts when the backup folder was deleted', async () => {
    // Folder was moved/deleted while the handle lived on in IndexedDB: getFileHandle
    // throws NotFoundError. Expect writeToFolder to drop the dead handle and rethrow
    // NeedsGestureError so the card reverts to "reconnect the folder" (spec E1.5/E1.11).
    const deadHandle = {
      kind: 'directory' as const,
      name: 'gone',
      queryPermission: async () => 'granted' as PermissionState,
      getFileHandle: async () => {
        throw new DOMException('folder is gone', 'NotFoundError')
      },
    } as unknown as FileSystemDirectoryHandle
    vi.spyOn(appMetaRepo, 'getDirHandle').mockResolvedValue(deadHandle)
    const clearSpy = vi.spyOn(appMetaRepo, 'clearDirHandle')
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve()
    await expect(runBackup()).rejects.toBeInstanceOf(NeedsGestureError)
    expect(clearSpy).toHaveBeenCalledOnce()
    expect(await appMetaRepo.getBackupRecord()).toBeNull() // no record written on failure
  })
})

describe('maybeBackupOnLaunch', () => {
  it('returns "nudge" when stale (no record) and no folder configured', async () => {
    expect(await maybeBackupOnLaunch()).toBe('nudge')
  })

  it('returns "noop" when a fresh record exists', async () => {
    await appMetaRepo.setBackupRecord({
      lastBackupAt: new Date().toISOString(),
      method: 'download',
      bytes: 10,
      rowCounts: {},
      schemaVersion: 1,
    })
    expect(await maybeBackupOnLaunch()).toBe('noop')
  })

  it('returns "backed-up" when stale and folder permission is granted', async () => {
    const writes: string[] = []
    // Spy, not setDirHandle — see the structuredClone note above.
    vi.spyOn(appMetaRepo, 'getDirHandle').mockResolvedValue(grantedHandle(writes))
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve()
    expect(await maybeBackupOnLaunch()).toBe('backed-up')
    expect(writes.length).toBe(1)
    expect((await appMetaRepo.getBackupRecord())?.method).toBe('fsa-folder')
  })
})
