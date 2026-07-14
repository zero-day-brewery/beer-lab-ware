import { DUMP_VERSION, type Dump } from '@/lib/db/backup'

const SUPPORTED_MIN = 1
const SUPPORTED_MAX = DUMP_VERSION // == 7 today; auto-tracks a future DumpV8

export type GuardResult =
  | { ok: true; dump: Dump; summary: Record<string, number> }
  | {
      ok: false
      reason: 'not-json' | 'malformed' | 'too-new' | 'unrecognized'
      message: string
    }

export function parseAndGuardDump(text: string): GuardResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not-json', message: 'That file is not valid JSON.' }
  }

  if (parsed === null || typeof parsed !== 'object') {
    return {
      ok: false,
      reason: 'malformed',
      message: 'That file is not a backup (no object body).',
    }
  }
  const obj = parsed as { version?: unknown; tables?: unknown }
  if (typeof obj.version !== 'number' || obj.tables === null || typeof obj.tables !== 'object') {
    return {
      ok: false,
      reason: 'malformed',
      message: 'That file is missing a backup version or tables.',
    }
  }

  const version = obj.version
  if (version > SUPPORTED_MAX) {
    return {
      ok: false,
      reason: 'too-new',
      message: `This backup was made by a newer version of the app (dump v${version}); this build supports up to v${SUPPORTED_MAX}. Update the app before importing so no data is dropped.`,
    }
  }
  if (!Number.isInteger(version) || version < SUPPORTED_MIN) {
    return {
      ok: false,
      reason: 'unrecognized',
      message: `Unrecognized backup version: ${version}.`,
    }
  }

  const tables = obj.tables as Record<string, unknown>
  const summary: Record<string, number> = {}
  for (const [name, rows] of Object.entries(tables)) {
    summary[name] = Array.isArray(rows) ? rows.length : 0
  }
  return { ok: true, dump: parsed as Dump, summary }
}
