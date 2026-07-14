// @vitest-environment jsdom
// tests/unit/charts/use-chart-size.test.tsx
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useChartSize } from '@/components/charts/use-chart-size'
import { installResizeObserver } from '../../helpers/resize-observer'

describe('useChartSize', () => {
  let restore: () => void
  afterEach(() => restore?.())

  it('is not ready until the observer reports a width', async () => {
    restore = installResizeObserver(0) // observer reports 0 → never ready
    const { result } = renderHook(() => useChartSize<HTMLDivElement>({ height: 200 }))
    // No element attached to the ref in renderHook → observe fires with width 0.
    expect(result.current.ready).toBe(false)
    expect(result.current.height).toBe(200)
  })

  it('becomes ready with a measured width via the observer', async () => {
    restore = installResizeObserver(320)
    const { result } = renderHook(() => {
      const size = useChartSize<HTMLDivElement>({ height: 180 })
      // Attach the ref to a real element so observe() runs against it.
      if (size.ref.current === null) {
        const el = document.createElement('div')
        ;(size.ref as { current: HTMLDivElement | null }).current = el
      }
      return size
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.width).toBeGreaterThanOrEqual(320)
  })
})
