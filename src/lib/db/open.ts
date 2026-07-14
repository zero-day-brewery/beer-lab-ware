import Dexie from 'dexie'
import { type BrewDB, db } from '@/lib/db/schema'

export type DbOpenResult =
  | { status: 'ok'; verno: number }
  | { status: 'blocked' }
  | { status: 'version-newer' }
  | { status: 'corrupt'; error: Error }
  | { status: 'quota'; error: Error }
  | { status: 'unknown'; error: Error }

export type DbFailure = Exclude<DbOpenResult, { status: 'ok' }>

const CORRUPT_NAMES = new Set([
  'NotFoundError',
  'InvalidStateError',
  'DataError',
  'AbortError',
  'DatabaseClosedError',
  'UnknownError',
  'ConstraintError',
])

export function classifyOpenError(err: unknown): DbOpenResult {
  const error = err instanceof Error ? err : new Error(String(err))
  if (error.name === 'VersionError') return { status: 'version-newer' }
  if (error.name === 'QuotaExceededError') return { status: 'quota', error }
  if (CORRUPT_NAMES.has(error.name)) return { status: 'corrupt', error }
  return { status: 'unknown', error }
}

export async function openDb(
  database: BrewDB = db,
  blockedTimeoutMs = 3000,
): Promise<DbOpenResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let blockedFired = false
  try {
    database.on('versionchange', () => {
      database.close()
      if (typeof location !== 'undefined') location.reload()
    })
    // 'blocked' does NOT reject open() — record that it genuinely fired so the
    // timeout race can tell a real block apart from a slow-but-healthy upgrade.
    database.on('blocked', () => {
      blockedFired = true
    })
    const outcome = await Promise.race([
      database.open().then(() => 'opened' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), blockedTimeoutMs)
      }),
    ])
    if (outcome === 'timeout') {
      // Only a genuine 'blocked' event routes to the "close the other tab" path.
      // A bare timeout (large-dataset upgrade still running) is not a block —
      // send it to the generic "taking too long / try reload" recovery instead.
      return blockedFired
        ? { status: 'blocked' }
        : {
            status: 'unknown',
            error: new Error(`Database open timed out after ${blockedTimeoutMs}ms`),
          }
    }
    // Dexie 4.x recovers from a downgrade `VersionError` by transparently
    // reopening the existing (higher) DB with no explicit version, so the raw
    // error never reaches `classifyOpenError`. Detect the newer-on-disk case
    // directly: the native `idbdb.version` (multiples of 10) outranks this
    // code's declared `verno * 10`. `idbdb` is not on Dexie's public type.
    const nativeVersion = (database as unknown as { idbdb?: { version?: number } | null }).idbdb
      ?.version
    if (nativeVersion !== undefined && nativeVersion > Math.round(database.verno * 10)) {
      return { status: 'version-newer' }
    }
    return { status: 'ok', verno: database.verno }
  } catch (err) {
    return classifyOpenError(err)
  } finally {
    // Cancel the soft-timeout once open() settles so ok/version-newer/corrupt/quota
    // never leak a live 3s timer into the page or the test runner.
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function salvageDump(database: BrewDB = db): Promise<Blob> {
  const tables: Record<string, unknown[]> = {}
  for (const table of database.tables) {
    try {
      tables[table.name] = await table.toArray() // raw — SKIP Zod
    } catch {
      tables[table.name] = []
    }
  }
  const body = JSON.stringify({ salvagedAt: new Date().toISOString(), tables }, null, 2)
  return new Blob([body], { type: 'application/json' })
}

export async function resetDb(database: BrewDB = db): Promise<void> {
  database.close()
  await Dexie.delete(database.name) // 'brew-db' for the singleton — drops appMeta too
}
