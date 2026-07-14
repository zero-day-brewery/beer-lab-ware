// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'
import { readingsRepo } from '@/lib/db/repos/readings'
import { db } from '@/lib/db/schema'
import { installResizeObserver } from '../../helpers/resize-observer'

const BATCH_ID = '99999999-9999-4999-8999-999999999999'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`id=${BATCH_ID}`),
}))

import { BatchSheetView, buildReadingFromForm } from '@/components/logbook/batch-sheet-view'

const sampleBatch = (): Batch => ({
  id: BATCH_ID,
  batchNo: 7,
  name: 'Hazy IPA',
  status: 'in-progress',
  process: [],
  logs: [],
  timers: [],
  results: {},
  startedAt: '2026-07-04T12:00:00.000Z',
  updatedAt: '2026-07-04T12:00:00.000Z',
  schemaVersion: 1,
})

describe('buildReadingFromForm', () => {
  it('parses fields and keeps canonical °C in metric', () => {
    const r = buildReadingFromForm(
      { at: '2026-07-04T14:30', gravity: '1.040', temp: '20', ph: '4.4', note: 'day 2' },
      BATCH_ID,
      'metric',
    )
    expect(r).not.toBeNull()
    expect(r?.gravity).toBe(1.04)
    expect(r?.tempC).toBe(20)
    expect(r?.ph).toBe(4.4)
    expect(r?.note).toBe('day 2')
    expect(r?.batchId).toBe(BATCH_ID)
  })

  it('converts imperial °F input back to canonical °C', () => {
    const r = buildReadingFromForm(
      { at: '2026-07-04T14:30', gravity: '', temp: '68', ph: '', note: '' },
      BATCH_ID,
      'imperial',
    )
    expect(r?.tempC).toBeCloseTo(20, 5)
    expect(r?.gravity).toBeUndefined()
  })

  it('drops empty / non-finite fields via the parse guard', () => {
    const r = buildReadingFromForm(
      { at: '2026-07-04T14:30', gravity: 'abc', temp: '', ph: '', note: 'note only' },
      BATCH_ID,
      'metric',
    )
    expect(r?.gravity).toBeUndefined()
    expect(r?.tempC).toBeUndefined()
    expect(r?.note).toBe('note only')
  })

  it('returns null when nothing measurable was entered', () => {
    const r = buildReadingFromForm(
      { at: '2026-07-04T14:30', gravity: '', temp: '', ph: '', note: '   ' },
      BATCH_ID,
      'metric',
    )
    expect(r).toBeNull()
  })
})

describe('FermentationReadings (via BatchSheetView)', () => {
  let restoreRO: () => void
  beforeEach(async () => {
    restoreRO = installResizeObserver(600)
    await db.readings.clear()
    await db.batches.clear()
    await db.batches.put(sampleBatch())
  })
  afterEach(async () => {
    restoreRO()
    await db.readings.clear()
    await db.batches.clear()
  })

  it('shows the empty chart hint before any readings exist', async () => {
    render(<BatchSheetView />)
    expect(await screen.findByText(/Fermentation Readings/i)).toBeInTheDocument()
    expect(screen.getByText(/Log a reading to start the fermentation curve/i)).toBeInTheDocument()
  })

  it('add-reading form writes via the repo; the log row and chart appear', async () => {
    const user = userEvent.setup()
    render(<BatchSheetView />)
    await screen.findByText(/Fermentation Readings/i)

    await user.type(screen.getByLabelText('Gravity'), '1.040')
    await user.type(screen.getByLabelText(/Temperature/i), '20')
    await user.click(screen.getByRole('button', { name: /log reading/i }))

    // Persisted through the repo.
    await waitFor(async () => {
      expect(await readingsRepo.listByBatch(BATCH_ID)).toHaveLength(1)
    })
    // Log table row rendered (gravity formatted to 3 dp). Scope to the table
    // cell — the migrated chart now draws a left-axis tick labelled 1.040 too.
    expect(await screen.findByRole('cell', { name: '1.040' })).toBeInTheDocument()
    // Chart now drawn (empty hint gone, svg present).
    expect(screen.queryByText(/Log a reading to start/i)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(document.querySelector('[data-testid="fermentation-chart"]')).not.toBeNull(),
    )
  })

  it('per-row delete removes the reading', async () => {
    const user = userEvent.setup()
    await readingsRepo.create({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      batchId: BATCH_ID,
      at: '2026-07-04T12:00:00.000Z',
      gravity: 1.03,
      schemaVersion: 1,
    })
    render(<BatchSheetView />)
    expect(await screen.findByText('1.030')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /delete reading/i }))

    await waitFor(async () => {
      expect(await readingsRepo.listByBatch(BATCH_ID)).toHaveLength(0)
    })
  })
})
