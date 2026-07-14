// @vitest-environment jsdom
// tests/unit/hooks/use-batch-readings.test.tsx
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useBatchReadings } from '@/hooks/use-batch-readings'
import type { Reading } from '@/lib/brewing/types/reading'
import { readingsRepo } from '@/lib/db/repos/readings'

const BATCH = 'batch-ubr-fixture'

function reading(id: string, at: string): Reading {
  return { id, batchId: BATCH, at, gravity: 1.04, tempC: 20, schemaVersion: 1 }
}

describe('useBatchReadings', () => {
  afterEach(async () => {
    for (const r of await readingsRepo.listByBatch(BATCH)) await readingsRepo.delete(r.id)
  })

  it('returns [] for a null or undefined batchId (opens no subscription)', () => {
    expect(renderHook(() => useBatchReadings(null)).result.current).toEqual([])
    expect(renderHook(() => useBatchReadings(undefined)).result.current).toEqual([])
  })

  it('live-queries one batch and returns its readings sorted by time', async () => {
    await readingsRepo.create(
      reading('11111111-1111-4111-8111-111111111111', '2026-07-05T00:00:00.000Z'),
    )
    await readingsRepo.create(
      reading('22222222-2222-4222-8222-222222222222', '2026-07-04T00:00:00.000Z'),
    )
    const { result } = renderHook(() => useBatchReadings(BATCH))
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(result.current.map((r) => r.at)).toEqual([
      '2026-07-04T00:00:00.000Z',
      '2026-07-05T00:00:00.000Z',
    ])
  })

  it('updates reactively when a reading is added', async () => {
    const { result } = renderHook(() => useBatchReadings(BATCH))
    await waitFor(() => expect(result.current).toHaveLength(0))
    await readingsRepo.create(
      reading('33333333-3333-4333-8333-333333333333', '2026-07-06T00:00:00.000Z'),
    )
    await waitFor(() => expect(result.current).toHaveLength(1))
  })
})
