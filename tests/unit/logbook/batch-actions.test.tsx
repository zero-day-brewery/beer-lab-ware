// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchRecord } from '@/lib/brewing/report/batch-record'
import type { Batch } from '@/lib/brewing/types/batch'

const listReadingsMock = vi.fn()
const listByBatchMock = vi.fn()
const listItemsMock = vi.fn()
const downloadBlobMock = vi.fn()
const downloadWorkbookMock = vi.fn()

vi.mock('@/lib/db/repos/readings', () => ({
  readingsRepo: { listByBatch: (...a: unknown[]) => listReadingsMock(...a) },
}))
vi.mock('@/lib/db/repos/stock-transactions', () => ({
  stockTransactionsRepo: { listByBatch: (...a: unknown[]) => listByBatchMock(...a) },
}))
vi.mock('@/lib/db/repos/inventory', () => ({
  inventoryRepo: { list: (...a: unknown[]) => listItemsMock(...a) },
}))
vi.mock('@/lib/report/download', () => ({
  downloadBlob: (...a: unknown[]) => downloadBlobMock(...a),
}))
vi.mock('@/lib/report/batch-xlsx', () => ({
  downloadBatchWorkbook: (...a: unknown[]) => downloadWorkbookMock(...a),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

import { BatchActions } from '@/components/logbook/batch-actions'

const batch = {
  id: '22222222-2222-4222-8222-222222222222',
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
} as unknown as Batch

describe('BatchActions', () => {
  beforeEach(() => {
    listReadingsMock.mockReset()
    listByBatchMock.mockReset()
    listItemsMock.mockReset()
    downloadBlobMock.mockReset()
    downloadWorkbookMock.mockReset()
    listReadingsMock.mockResolvedValue([
      {
        id: 'r1',
        batchId: batch.id,
        at: '2026-07-05T12:00:00.000Z',
        gravity: 1.04,
        tempC: 20,
        note: 'krausen, high',
        schemaVersion: 1,
      },
    ])
    listByBatchMock.mockResolvedValue([])
    listItemsMock.mockResolvedValue([])
  })

  it('downloads the readings CSV with escaped content and a batch-numbered filename', async () => {
    const user = userEvent.setup()
    render(<BatchActions batch={batch} />)

    await user.click(screen.getByRole('button', { name: /readings csv/i }))

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
    const [blob, filename] = downloadBlobMock.mock.calls[0] as [Blob, string]
    expect(filename).toBe('beer-lab-ware-batch-7-readings.csv')
    const text = await blob.text()
    expect(text).toContain('at,gravity,tempC,ph,note')
    expect(text).toContain('2026-07-05T12:00:00.000Z,1.04,20,,"krausen, high"')
  })

  it('builds the batch record from live repos and hands it to the workbook downloader', async () => {
    const user = userEvent.setup()
    render(<BatchActions batch={batch} />)

    await user.click(screen.getByRole('button', { name: /batch record/i }))

    await waitFor(() => expect(downloadWorkbookMock).toHaveBeenCalledTimes(1))
    const record = downloadWorkbookMock.mock.calls[0]?.[0] as BatchRecord
    expect(record.batchNo).toBe(7)
    expect(record.readings).toHaveLength(1)
    expect(record.cost.lines).toEqual([])
    expect(record.cost.currency).toBe('USD')
  })

  it('renders a Print button (print styling handled by the print stylesheet)', () => {
    render(<BatchActions batch={batch} />)
    expect(screen.getByRole('button', { name: /^print$/i })).toBeInTheDocument()
  })
})
