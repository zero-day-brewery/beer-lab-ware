import type { Batch } from '@/lib/brewing/types/batch'
import type { Reading } from '@/lib/brewing/types/reading'

/**
 * Per-batch fermentation-readings CSV — a tiny pure serializer (no DOM, no
 * Dexie). Values stay CANONICAL: ISO-8601 timestamps and °C (the header says
 * `tempC` so the unit is explicit in the file itself), matching the storage
 * convention; spreadsheets can convert downstream.
 *
 * RFC 4180: CRLF row endings; any field containing a comma, quote, CR, or LF
 * is quoted with internal quotes doubled.
 */

const HEADER = ['at', 'gravity', 'tempC', 'ph', 'note'] as const

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function field(value: number | string | undefined): string {
  if (value === undefined) return ''
  return escapeField(String(value))
}

export function readingsToCsv(readings: readonly Reading[]): string {
  const rows = [...readings]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((r) => [field(r.at), field(r.gravity), field(r.tempC), field(r.ph), field(r.note)])
  return [HEADER.join(','), ...rows.map((cells) => cells.join(','))]
    .map((line) => `${line}\r\n`)
    .join('')
}

export function readingsCsvFilename(batch: Pick<Batch, 'batchNo'>): string {
  return `beer-lab-ware-batch-${batch.batchNo}-readings.csv`
}
