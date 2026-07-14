// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ColumnResizeHandle, useResizableColumns } from '@/components/ui/resizable-columns'
import { type ColumnDef, storageKey } from '@/lib/ui/column-resize'

const COLS: ColumnDef[] = [
  { id: 'name', label: 'Name', min: 60, initial: 120 },
  { id: 'qty', label: 'Qty', min: 40, initial: 80 },
  { id: 'actions', label: 'Actions', min: 100, flex: true },
]

/** Minimal grid harness exercising the reusable primitive end-to-end. */
function Harness({ tableId = 'harness' }: { tableId?: string }) {
  const { gridTemplateColumns, getHandleProps, widths, resetAll } = useResizableColumns(
    tableId,
    COLS,
  )
  return (
    <div>
      <div data-testid="head" style={{ gridTemplateColumns }}>
        {COLS.map((c) => (
          <span key={c.id} className="rz-host">
            {c.label}
            {!c.flex && <ColumnResizeHandle {...getHandleProps(c.id)} />}
          </span>
        ))}
      </div>
      {/* a data row proves rows adopt the same state-driven template */}
      <div data-testid="row" style={{ gridTemplateColumns }}>
        {COLS.map((c) => (
          <span key={c.id}>{c.id}-cell</span>
        ))}
      </div>
      <output data-testid="widths">{JSON.stringify(widths)}</output>
      <button type="button" onClick={resetAll}>
        reset all
      </button>
    </div>
  )
}

const widthOf = (col: string): number =>
  JSON.parse(screen.getByTestId('widths').textContent ?? '{}')[col]

beforeEach(() => {
  localStorage.clear()
})

describe('useResizableColumns + ColumnResizeHandle', () => {
  it('renders one grip per resizable column (never the flex column) and the rows still render', () => {
    render(<Harness />)
    const handles = screen.getAllByRole('separator')
    expect(handles).toHaveLength(2) // name + qty, not actions
    expect(screen.getByRole('separator', { name: 'Resize Name' })).toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize Actions' })).not.toBeInTheDocument()

    // Rows render, and head + row share the same state-driven template.
    expect(screen.getByText('name-cell')).toBeInTheDocument()
    const head = screen.getByTestId('head')
    const row = screen.getByTestId('row')
    expect(head.style.gridTemplateColumns).toBe('120px 80px minmax(100px, 1fr)')
    expect(row.style.gridTemplateColumns).toBe(head.style.gridTemplateColumns)
  })

  it('ArrowRight widens a column and persists it', async () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize Name' })
    expect(widthOf('name')).toBe(120)

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOf('name')).toBe(136) // +16 default step
    expect(handle).toHaveAttribute('aria-valuenow', '136')

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(storageKey('harness')) ?? '{}').name).toBe(136),
    )
    // Head template reflects the new width live.
    expect(screen.getByTestId('head').style.gridTemplateColumns).toBe(
      '136px 80px minmax(100px, 1fr)',
    )
  })

  it('ArrowLeft narrows a column and clamps at the column floor', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize Qty' })
    // From 80, min 40 → 3 steps of 16 would hit 32, must clamp to 40.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' }) // 64
    fireEvent.keyDown(handle, { key: 'ArrowLeft' }) // 48
    fireEvent.keyDown(handle, { key: 'ArrowLeft' }) // 32 → 40
    expect(widthOf('qty')).toBe(40)
  })

  it('Home resets a column to its default width', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize Name' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOf('name')).toBe(136)
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(widthOf('name')).toBe(120)
  })

  it('double-click resets a column to its default width', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize Name' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOf('name')).toBe(152)
    fireEvent.doubleClick(handle)
    expect(widthOf('name')).toBe(120)
  })

  it('pointer drag updates the column width and persists on release', async () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize Name' })
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 250 }) // +50
    expect(widthOf('name')).toBe(170)
    fireEvent.pointerUp(window, { clientX: 250 })

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(storageKey('harness')) ?? '{}').name).toBe(170),
    )
    // Listeners are torn down on release — a further move is a no-op.
    fireEvent.pointerMove(window, { clientX: 400 })
    expect(widthOf('name')).toBe(170)
  })

  it('hydrates persisted widths from localStorage after mount', async () => {
    localStorage.setItem(storageKey('seeded'), JSON.stringify({ name: 240, qty: 55 }))
    render(<Harness tableId="seeded" />)
    await waitFor(() => expect(widthOf('name')).toBe(240))
    expect(widthOf('qty')).toBe(55)
    expect(screen.getByTestId('head').style.gridTemplateColumns).toBe(
      '240px 55px minmax(100px, 1fr)',
    )
  })

  it('resetAll returns every column to its default', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize Name' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOf('name')).toBe(136)
    fireEvent.click(screen.getByRole('button', { name: 'reset all' }))
    expect(widthOf('name')).toBe(120)
    expect(widthOf('qty')).toBe(80)
  })
})
