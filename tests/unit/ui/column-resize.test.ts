// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyDelta,
  buildGridTemplate,
  type ColumnDef,
  clampWidth,
  clearWidths,
  columnMin,
  defaultWidth,
  defaultWidths,
  loadWidths,
  MIN_COLUMN_WIDTH,
  reconcileWidths,
  saveWidths,
  storageKey,
} from '@/lib/ui/column-resize'

const COLS: ColumnDef[] = [
  { id: 'a', label: 'Alpha', min: 50, initial: 100 },
  { id: 'b', label: 'Beta', min: 40, initial: 80 },
  { id: 'z', label: 'Zed', min: 60, flex: true },
]

beforeEach(() => {
  localStorage.clear()
})

describe('columnMin / clampWidth', () => {
  it('honors a per-column min, falling back to the global floor', () => {
    expect(columnMin(COLS[0])).toBe(50)
    expect(columnMin({ id: 'x', label: 'X' })).toBe(MIN_COLUMN_WIDTH)
  })

  it('clamps a width up to the column floor and rounds', () => {
    expect(clampWidth(COLS[0], 10)).toBe(50) // below min → min
    expect(clampWidth(COLS[0], 123.6)).toBe(124) // rounded
    expect(clampWidth(COLS[0], 200)).toBe(200)
  })

  it('treats a non-finite width as the floor', () => {
    expect(clampWidth(COLS[0], Number.NaN)).toBe(50)
    expect(clampWidth(COLS[0], Number.POSITIVE_INFINITY)).toBe(50)
  })
})

describe('applyDelta', () => {
  it('adds a positive delta', () => {
    expect(applyDelta(COLS[0], 100, 30)).toBe(130)
  })

  it('clamps a negative delta to the column floor', () => {
    expect(applyDelta(COLS[0], 60, -40)).toBe(50) // 20 → clamped to 50
  })
})

describe('defaultWidth / defaultWidths', () => {
  it('uses initial when present, else the floor, and skips flex columns', () => {
    expect(defaultWidth(COLS[0])).toBe(100)
    expect(defaultWidth({ id: 'x', label: 'X', min: 70 })).toBe(70)
    expect(defaultWidths(COLS)).toEqual({ a: 100, b: 80 }) // no 'z' (flex)
  })
})

describe('reconcileWidths', () => {
  it('returns defaults when nothing is stored', () => {
    expect(reconcileWidths(COLS, null)).toEqual({ a: 100, b: 80 })
  })

  it('merges stored values over defaults, dropping unknown ids and ignoring flex', () => {
    expect(reconcileWidths(COLS, { a: 200, ghost: 999, z: 400 })).toEqual({ a: 200, b: 80 })
  })

  it('re-clamps a stale stored value that is under the current floor', () => {
    expect(reconcileWidths(COLS, { a: 5 })).toEqual({ a: 50, b: 80 })
  })
})

describe('buildGridTemplate', () => {
  it('emits fixed px for tracked columns and minmax for the flex column', () => {
    expect(buildGridTemplate(COLS, { a: 120, b: 90 })).toBe('120px 90px minmax(60px, 1fr)')
  })

  it('falls back to a column default when a width is missing', () => {
    expect(buildGridTemplate(COLS, {})).toBe('100px 80px minmax(60px, 1fr)')
  })
})

describe('persistence (localStorage)', () => {
  it('derives a namespaced key per table', () => {
    expect(storageKey('water-compare')).toBe('bbc:colw:water-compare')
  })

  it('round-trips saved widths through load', () => {
    saveWidths('t1', { a: 175, b: 65 })
    expect(loadWidths('t1', COLS)).toEqual({ a: 175, b: 65 })
    // Persisted under the derived key.
    expect(localStorage.getItem(storageKey('t1'))).toBe(JSON.stringify({ a: 175, b: 65 }))
  })

  it('returns defaults for an unknown table', () => {
    expect(loadWidths('never-saved', COLS)).toEqual({ a: 100, b: 80 })
  })

  it('returns defaults (never throws) on malformed JSON', () => {
    localStorage.setItem(storageKey('bad'), '{not json')
    expect(loadWidths('bad', COLS)).toEqual({ a: 100, b: 80 })
  })

  it('reconciles a stored value below the floor on load', () => {
    saveWidths('t2', { a: 1 })
    expect(loadWidths('t2', COLS)).toEqual({ a: 50, b: 80 })
  })

  it('clears a table’s persisted widths', () => {
    saveWidths('t3', { a: 150 })
    clearWidths('t3')
    expect(localStorage.getItem(storageKey('t3'))).toBeNull()
    expect(loadWidths('t3', COLS)).toEqual({ a: 100, b: 80 })
  })
})
