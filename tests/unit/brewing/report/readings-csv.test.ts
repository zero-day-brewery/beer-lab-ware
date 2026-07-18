import { describe, expect, it } from 'vitest'
import { readingsCsvFilename, readingsToCsv } from '@/lib/brewing/report/readings-csv'
import type { Reading } from '@/lib/brewing/types/reading'

function reading(overrides: Partial<Reading> & { id: string; at: string }): Reading {
  return { batchId: 'b1', schemaVersion: 1, ...overrides }
}

describe('readingsToCsv', () => {
  it('serializes the header + one row per reading (ISO timestamp, gravity, tempC, ph, note)', () => {
    const csv = readingsToCsv([
      reading({ id: 'r1', at: '2026-07-01T12:00:00.000Z', gravity: 1.05, tempC: 20 }),
      reading({ id: 'r2', at: '2026-07-02T12:00:00.000Z', gravity: 1.03, tempC: 19.5, ph: 4.4 }),
    ])
    expect(csv).toBe(
      'at,gravity,tempC,ph,note\r\n' +
        '2026-07-01T12:00:00.000Z,1.05,20,,\r\n' +
        '2026-07-02T12:00:00.000Z,1.03,19.5,4.4,\r\n',
    )
  })

  it('sorts rows chronologically regardless of input order', () => {
    const csv = readingsToCsv([
      reading({ id: 'r2', at: '2026-07-02T12:00:00.000Z', gravity: 1.03 }),
      reading({ id: 'r1', at: '2026-07-01T12:00:00.000Z', gravity: 1.05 }),
    ])
    const rows = csv.trimEnd().split('\r\n')
    expect(rows[1]).toMatch(/^2026-07-01/)
    expect(rows[2]).toMatch(/^2026-07-02/)
  })

  it('escapes commas, quotes, and newlines in notes per RFC 4180', () => {
    const csv = readingsToCsv([
      reading({ id: 'r1', at: '2026-07-01T12:00:00.000Z', note: 'krausen, falling' }),
      reading({ id: 'r2', at: '2026-07-02T12:00:00.000Z', note: 'dry-hop "2 oz"' }),
      reading({ id: 'r3', at: '2026-07-03T12:00:00.000Z', note: 'line1\nline2' }),
    ])
    const rows = csv.split('\r\n')
    expect(rows[1]).toBe('2026-07-01T12:00:00.000Z,,,,"krausen, falling"')
    expect(rows[2]).toBe('2026-07-02T12:00:00.000Z,,,,"dry-hop ""2 oz"""')
    // The newline note is quoted, so its row spans two physical lines.
    expect(csv).toContain(',"line1\nline2"')
  })

  it('emits just the header for an empty list', () => {
    expect(readingsToCsv([])).toBe('at,gravity,tempC,ph,note\r\n')
  })
})

describe('readingsCsvFilename', () => {
  it('derives a batch-numbered filename', () => {
    expect(readingsCsvFilename({ batchNo: 7 })).toBe('beer-lab-ware-batch-7-readings.csv')
  })
})
