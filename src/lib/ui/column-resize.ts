/**
 * Pure, framework-free logic for resizable data-table columns.
 *
 * This module is the testable core of the reusable column-resize primitive
 * (the React hook + handle component live in
 * `src/components/ui/resizable-columns.tsx`). It knows how to:
 *   - clamp a column width to its per-column floor,
 *   - apply a drag/keyboard delta,
 *   - build a `grid-template-columns` string for CSS-grid tables,
 *   - persist/restore a table's widths to localStorage.
 *
 * No DOM, no React — safe to unit-test in the `node` environment (the
 * localStorage helpers no-op when Web Storage is unavailable).
 */

/** Absolute floor for any column, in px, unless a column sets its own `min`. */
export const MIN_COLUMN_WIDTH = 48
/** Default px step applied per Arrow key press. */
export const DEFAULT_STEP = 16
/** localStorage key prefix — namespaced so one table's widths never collide. */
export const STORAGE_PREFIX = 'bbc:colw:'

export interface ColumnDef {
  /** Stable identifier, unique within a table. */
  id: string
  /** Human label — drives the handle's `aria-label` ("Resize <label>"). */
  label: string
  /** px floor for this column (defaults to {@link MIN_COLUMN_WIDTH}). */
  min?: number
  /** Starting px width for a tracked (resizable) column. */
  initial?: number
  /**
   * A flexible fill column: takes the remaining space, is NOT resizable, and
   * carries no persisted width. Typically the trailing "actions" column.
   */
  flex?: boolean
}

/** Per-column tracked widths, keyed by column id (flex columns are absent). */
export type WidthMap = Record<string, number>

/** localStorage key for a given table's persisted widths. */
export function storageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`
}

/** Effective px floor for a column, honoring its per-column `min`. */
export function columnMin(col: ColumnDef): number {
  return Math.max(1, col.min ?? MIN_COLUMN_WIDTH)
}

/** Round + clamp a width to the column's floor. Non-finite → the floor. */
export function clampWidth(col: ColumnDef, width: number): number {
  const min = columnMin(col)
  if (!Number.isFinite(width)) return min
  return Math.max(min, Math.round(width))
}

/** Apply a drag/keyboard delta to a base width, clamped to the column floor. */
export function applyDelta(col: ColumnDef, current: number, delta: number): number {
  return clampWidth(col, current + delta)
}

/** The default width for a single tracked column (its `initial`, else its floor). */
export function defaultWidth(col: ColumnDef): number {
  return clampWidth(col, col.initial ?? columnMin(col))
}

/** Default widths for every tracked (non-flex) column. */
export function defaultWidths(columns: ColumnDef[]): WidthMap {
  const out: WidthMap = {}
  for (const col of columns) {
    if (col.flex) continue
    out[col.id] = defaultWidth(col)
  }
  return out
}

/**
 * Merge stored widths over the defaults: unknown ids are dropped, missing ids
 * fall back to their default, and every value is re-clamped to its current
 * floor (so a shrunk `min` in code can't be undercut by a stale stored value).
 */
export function reconcileWidths(columns: ColumnDef[], stored: Partial<WidthMap> | null): WidthMap {
  const base = defaultWidths(columns)
  if (!stored) return base
  for (const col of columns) {
    if (col.flex) continue
    const v = stored[col.id]
    if (typeof v === 'number' && Number.isFinite(v)) {
      base[col.id] = clampWidth(col, v)
    }
  }
  return base
}

/**
 * The `grid-template-columns` string for a CSS-grid table: a fixed `<px>` track
 * per tracked column and `minmax(<min>px, 1fr)` for each flex column so the
 * trailing column fills remaining space.
 */
export function buildGridTemplate(columns: ColumnDef[], widths: WidthMap): string {
  return columns
    .map((col) => {
      if (col.flex) return `minmax(${columnMin(col)}px, 1fr)`
      const w = widths[col.id] ?? defaultWidth(col)
      return `${w}px`
    })
    .join(' ')
}

/** Whether Web Storage is usable in the current runtime (SSR/export → false). */
function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

/**
 * Read + reconcile a table's persisted widths. Returns defaults on any failure
 * (no storage, missing key, malformed JSON) so callers always get a valid map.
 */
export function loadWidths(tableId: string, columns: ColumnDef[]): WidthMap {
  if (!hasStorage()) return defaultWidths(columns)
  try {
    const raw = localStorage.getItem(storageKey(tableId))
    if (!raw) return defaultWidths(columns)
    const parsed = JSON.parse(raw) as Partial<WidthMap>
    if (!parsed || typeof parsed !== 'object') return defaultWidths(columns)
    return reconcileWidths(columns, parsed)
  } catch {
    return defaultWidths(columns)
  }
}

/** Persist a table's widths. Silent on failure (private mode / quota). */
export function saveWidths(tableId: string, widths: WidthMap): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(storageKey(tableId), JSON.stringify(widths))
  } catch {
    /* ignore — a resize that can't persist still works for the session */
  }
}

/** Remove a table's persisted widths (used by a full reset). */
export function clearWidths(tableId: string): void {
  if (!hasStorage()) return
  try {
    localStorage.removeItem(storageKey(tableId))
  } catch {
    /* ignore */
  }
}
