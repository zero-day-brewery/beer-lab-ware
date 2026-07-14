import { type BackupStatus, deriveBackupStatus } from '@/hooks/use-backup-status'
import { makeAppMetaRepo } from '@/lib/db/repos/app-meta'
import { type BrewDB, db } from '@/lib/db/schema'
import { type DiagnosticEntry, getDiagnostics } from '@/lib/diagnostics/error-log'
import {
  getPersistenceState,
  getStorageEstimate,
  type PersistenceState,
  type StorageEstimate,
} from '@/lib/storage/durability'
import { type AppVersion, getAppVersion } from '@/lib/version'

export interface DiagTableCount {
  name: string
  count: number
}

export interface DiagSwInfo {
  supported: boolean
  registered: boolean
  scope: string | null
  precacheVersion: string | null
}

export interface DiagnosticsSnapshot {
  build: AppVersion
  // verno is null when the schema version can't be read (DB failed to open / threw).
  db: { verno: number | null; open: boolean; tables: DiagTableCount[] }
  storage: { persistence: PersistenceState; estimate: StorageEstimate | null }
  backup: BackupStatus
  sw: DiagSwInfo
  ring: DiagnosticEntry[]
}

/** Run an async source; on any throw/reject, return `fallback`. Keeps a single
 *  degraded source from rejecting the whole snapshot (blank-spinner-forever). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

/** Sync cousin of `safe` for the cheap, non-async sources (build stamp, verno, ring). */
function safeSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const SW_UNAVAILABLE: DiagSwInfo = {
  supported: false,
  registered: false,
  scope: null,
  precacheVersion: null,
}

/** SSR/jsdom-safe. `precacheVersion` is the SW's single active cache name — the
 *  rewritten sw.js opens exactly one cache named PRECACHE_VERSION and also serves
 *  runtime SWR puts into it, so caches.keys()[0] is that version. Null when the SW
 *  API or CacheStorage is unavailable (node/jsdom/unsupported). No network.
 *  Caveat (display-only, never a correctness bug): during a SW update the old and
 *  new precache caches briefly coexist; caches.keys() is insertion-ordered, so [0]
 *  can transiently surface the PREVIOUS version until `activate` prunes the stale
 *  cache. Acceptable for a diagnostics readout; never exercised in node/jsdom. */
async function readSwInfo(): Promise<DiagSwInfo> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return { supported: false, registered: false, scope: null, precacheVersion: null }
  }
  const reg = await navigator.serviceWorker.getRegistration()
  let precacheVersion: string | null = null
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    precacheVersion = keys[0] ?? null
  }
  return {
    supported: true,
    registered: reg !== undefined,
    scope: reg?.scope ?? null,
    precacheVersion,
  }
}

/** Point-in-time diagnostics read-model. Cheap only — per-table count() (14 O(1)
 *  counts), storage estimate, one appMeta read, SW probe. The EXPENSIVE integrity
 *  doctor is NOT gathered here; it runs on demand from IntegritySection. */
export async function collectDiagnostics(database: BrewDB = db): Promise<DiagnosticsSnapshot> {
  // Best-effort open. A broken DB must NOT blank the panel — the DB-independent
  // sections (build / SW / error-log) still render even when the DB won't open.
  const open = await safe(async () => {
    if (!database.isOpen()) await database.open()
    return database.isOpen()
  }, false)
  const repo = makeAppMetaRepo(database)
  // Each source is isolated: one failing source yields a neutral/partial value and
  // the rest still populate. This function always resolves (never rejects).
  const [tables, persistence, estimate, record, sw] = await Promise.all([
    safe(
      () =>
        Promise.all(database.tables.map(async (t) => ({ name: t.name, count: await t.count() }))),
      [] as DiagTableCount[],
    ),
    safe(() => getPersistenceState(), 'unsupported' as PersistenceState),
    safe(() => getStorageEstimate(), null),
    safe(() => repo.getBackupRecord(), null),
    safe(() => readSwInfo(), SW_UNAVAILABLE),
  ])
  return {
    build: safeSync(getAppVersion, { version: 'unavailable', sha: 'unavailable', builtAt: '' }),
    db: { verno: safeSync(() => database.verno, null), open, tables },
    storage: { persistence, estimate },
    backup: deriveBackupStatus(record),
    sw,
    ring: safeSync(() => getDiagnostics().ring, []),
  }
}
