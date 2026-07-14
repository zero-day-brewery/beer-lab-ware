'use client'
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  applyDelta,
  buildGridTemplate,
  type ColumnDef,
  clampWidth,
  columnMin,
  DEFAULT_STEP,
  defaultWidth,
  defaultWidths,
  loadWidths,
  saveWidths,
  type WidthMap,
} from '@/lib/ui/column-resize'

export type { ColumnDef } from '@/lib/ui/column-resize'

/** Props spread onto a resize grip (`<ColumnResizeHandle {...getHandleProps(id)} />`). */
export interface ColumnResizeHandleProps {
  role: 'separator'
  tabIndex: 0
  'aria-orientation': 'vertical'
  'aria-label': string
  'aria-valuenow': number
  'aria-valuemin': number
  className: string
  onPointerDown: (e: ReactPointerEvent) => void
  onKeyDown: (e: ReactKeyboardEvent) => void
  onDoubleClick: () => void
}

export interface UseResizableColumns {
  /** Tracked per-column widths (flex columns absent). */
  widths: WidthMap
  /** `grid-template-columns` string — apply to a grid table's header AND rows. */
  gridTemplateColumns: string
  /** True for tracked (resizable) columns; false for flex columns. */
  isResizable: (colId: string) => boolean
  /** `<col>` / `<th>` style for a real `<table>` in `table-layout: fixed` mode. */
  getColStyle: (colId: string) => CSSProperties | undefined
  /** Props for the grip on a column's right boundary. */
  getHandleProps: (colId: string) => ColumnResizeHandleProps
  /** Reset one column to its default width (double-click / Home). */
  resetColumn: (colId: string) => void
  /** Reset every column to its default width. */
  resetAll: () => void
}

/**
 * Reusable drag/keyboard column-resize state for any multi-column data table.
 *
 * Give it a stable `tableId` and an ordered `columns` list; it manages per-column
 * widths, persists them to localStorage (keyed off `tableId`), and hands back a
 * `grid-template-columns` string (grid tables) plus `<col>` styles (real tables)
 * and fully-wired grip props (pointer + keyboard, `role="separator"`).
 *
 * SSR/static-export safe: the first render always uses deterministic defaults;
 * stored widths hydrate in an effect after mount (no hydration mismatch).
 */
export function useResizableColumns(
  tableId: string,
  columns: ColumnDef[],
  opts: { step?: number } = {},
): UseResizableColumns {
  const step = opts.step ?? DEFAULT_STEP

  // Columns are stable per table; hold them in a ref so callbacks stay correct
  // without re-subscribing and the initial state never touches storage.
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const [widths, setWidths] = useState<WidthMap>(() => defaultWidths(columns))
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  // Hydrate persisted widths after mount (keeps SSR/export output deterministic).
  useEffect(() => {
    setWidths(loadWidths(tableId, columnsRef.current))
  }, [tableId])

  const colById = useCallback(
    (colId: string): ColumnDef | undefined => columnsRef.current.find((c) => c.id === colId),
    [],
  )

  // Single write path: update state + persist from the freshest map.
  const commit = useCallback(
    (colId: string, next: number) => {
      if (widthsRef.current[colId] === next) return
      const merged = { ...widthsRef.current, [colId]: next }
      widthsRef.current = merged
      setWidths(merged)
      saveWidths(tableId, merged)
    },
    [tableId],
  )

  const resetColumn = useCallback(
    (colId: string) => {
      const col = colById(colId)
      if (!col || col.flex) return
      commit(colId, defaultWidth(col))
    },
    [colById, commit],
  )

  const resetAll = useCallback(() => {
    const next = defaultWidths(columnsRef.current)
    widthsRef.current = next
    setWidths(next)
    saveWidths(tableId, next)
  }, [tableId])

  const isResizable = useCallback(
    (colId: string): boolean => {
      const col = colById(colId)
      return !!col && !col.flex
    },
    [colById],
  )

  const getColStyle = useCallback(
    (colId: string): CSSProperties | undefined => {
      const col = colById(colId)
      if (!col || col.flex) return undefined
      const w = widthsRef.current[colId] ?? defaultWidth(col)
      return { width: `${w}px` }
    },
    [colById],
  )

  const getHandleProps = useCallback(
    (colId: string): ColumnResizeHandleProps => {
      const col = colById(colId)
      const min = col ? columnMin(col) : 1
      const current = (col && widthsRef.current[colId]) ?? min

      const onPointerDown = (e: ReactPointerEvent) => {
        const c = colById(colId)
        if (!c || c.flex) return
        e.preventDefault()
        const startX = e.clientX
        const startWidth = widthsRef.current[colId] ?? defaultWidth(c)
        // Window listeners survive the pointer leaving the thin grip mid-drag.
        const move = (ev: PointerEvent) => {
          commit(colId, applyDelta(c, startWidth, ev.clientX - startX))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const onKeyDown = (e: ReactKeyboardEvent) => {
        const c = colById(colId)
        if (!c || c.flex) return
        const cur = widthsRef.current[colId] ?? defaultWidth(c)
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          commit(colId, applyDelta(c, cur, -step))
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          commit(colId, applyDelta(c, cur, step))
        } else if (e.key === 'Home') {
          e.preventDefault()
          resetColumn(colId)
        }
      }

      return {
        role: 'separator',
        tabIndex: 0,
        'aria-orientation': 'vertical',
        'aria-label': `Resize ${col?.label ?? colId}`,
        'aria-valuenow': current,
        'aria-valuemin': min,
        className: 'rz-handle',
        onPointerDown,
        onKeyDown,
        onDoubleClick: () => resetColumn(colId),
      }
    },
    [colById, commit, resetColumn, step],
  )

  return {
    widths,
    gridTemplateColumns: buildGridTemplate(columns, widths),
    isResizable,
    getColStyle,
    getHandleProps,
    resetColumn,
    resetAll,
  }
}

/**
 * The draggable grip rendered on a column's right boundary. A faint token-driven
 * vertical bar (a wider transparent hit area around it) that brightens on
 * hover/focus. Spread {@link UseResizableColumns.getHandleProps} onto it.
 */
export function ColumnResizeHandle(props: ColumnResizeHandleProps) {
  // A span (not a button) so role="separator" is the sole semantics.
  // biome-ignore lint/a11y/useFocusableInteractive: role=separator + tabIndex=0 is the WAI splitter pattern.
  return <span {...props} />
}

/** Convenience clamp re-export for consumers building custom controls. */
export { clampWidth }
