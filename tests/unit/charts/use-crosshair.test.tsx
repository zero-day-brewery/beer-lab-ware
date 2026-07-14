// @vitest-environment jsdom
// tests/unit/charts/use-crosshair.test.tsx
import { act, renderHook } from '@testing-library/react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { useCrosshair } from '@/components/charts/use-crosshair'
import { buildChartModel } from '@/lib/brewing/charts/build-chart-model'
import type { AxisConfig, SeriesConfig } from '@/lib/brewing/charts/types'

const T0 = Date.parse('2026-07-04T00:00:00.000Z')
const DAY = 86_400_000
const left: AxisConfig = { label: 'L', format: (v) => `${v}` }
const right: AxisConfig = { label: 'R', format: (v) => `${v}` }

function series(id: string, axis: 'left' | 'right', n: number): SeriesConfig {
  return {
    id,
    label: id,
    axis,
    color: 'x',
    format: (v) => `${v}`,
    data: Array.from({ length: n }, (_, i) => ({ t: T0 + i * DAY, v: 1 + i })),
  }
}

function ptr(clientX: number, rectLeft = 0): PointerEvent<Element> {
  // rectLeft models the capture <rect>'s on-screen left. Because the rect is drawn
  // inside <g translate(inner.x)>, its real getBoundingClientRect().left already
  // includes inner.x — the landing test below sets rectLeft to prove locate() does
  // not subtract inner.x a second time.
  const target = {
    getBoundingClientRect: () =>
      ({
        left: rectLeft,
        top: 0,
        width: 296,
        height: 160,
        right: rectLeft + 296,
        bottom: 160,
        x: rectLeft,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  }
  return {
    clientX,
    pointerId: 1,
    currentTarget: target,
    preventDefault: () => {},
  } as unknown as PointerEvent<Element>
}
function key(k: string): KeyboardEvent<Element> {
  return { key: k, preventDefault: () => {} } as unknown as KeyboardEvent<Element>
}

describe('useCrosshair', () => {
  it('falls back to temp when the preferred gravity series is empty (temp-only)', () => {
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 0), series('temp', 'right', 3)],
      left,
      right,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    expect(result.current.primaryId).toBe('temp')
    act(() => result.current.handlers.onPointerMove(ptr(200)))
    expect(result.current.active).toBe(true)
    expect(result.current.index).not.toBeNull()
  })

  it('falls back to the first non-empty series (pH-only)', () => {
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 0), series('ph', 'left', 3)],
      left,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    expect(result.current.primaryId).toBe('ph')
  })

  it('is inactive when every series is empty', () => {
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 0), series('temp', 'right', 0)],
      left,
      right,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    expect(result.current.primaryId).toBeNull()
    act(() => result.current.handlers.onPointerMove(ptr(200)))
    expect(result.current.active).toBe(false)
    expect(result.current.index).toBeNull()
  })

  it('pins the index to 0 for a single-point series', () => {
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 1)],
      left,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    act(() => result.current.handlers.onPointerMove(ptr(5)))
    expect(result.current.index).toBe(0)
    act(() => result.current.handlers.onPointerMove(ptr(390)))
    expect(result.current.index).toBe(0)
  })

  it('selects the reading under the pointer without double-subtracting inner.x', () => {
    // 3 points over 2 days on a 400px chart: inner.x=52, inner.width=296 → cx [0,148,296].
    // The capture <rect> lives inside translate(inner.x), so its screen rect.left (100
    // here) already carries inner.x. locate() must map px = clientX - rect.left ONLY.
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 3)],
      left,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    act(() => result.current.handlers.onPointerMove(ptr(100, 100))) // px 0 → first reading
    expect(result.current.index).toBe(0)
    // px 80 sits just past the 0↔1 midpoint (74). The correct formula lands on index 1;
    // an extra `- inner.x` (px 28) would wrongly snap back to index 0 — this is the assertion
    // that fails under the double-subtraction bug.
    act(() => result.current.handlers.onPointerMove(ptr(180, 100)))
    expect(result.current.index).toBe(1)
    act(() => result.current.handlers.onPointerMove(ptr(396, 100))) // px 296 → last reading
    expect(result.current.index).toBe(2)
  })

  it('ArrowRight/ArrowLeft step and clamp the crosshair index', () => {
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 3)],
      left,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    act(() => result.current.handlers.onKeyDown(key('ArrowRight')))
    expect(result.current.active).toBe(true)
    expect(result.current.index).toBe(1)
    act(() => result.current.handlers.onKeyDown(key('ArrowRight')))
    act(() => result.current.handlers.onKeyDown(key('ArrowRight')))
    expect(result.current.index).toBe(2) // clamped at the last index
    act(() => result.current.handlers.onKeyDown(key('ArrowLeft')))
    expect(result.current.index).toBe(1)
  })

  it('clears on pointer leave and cancel', () => {
    const model = buildChartModel({
      width: 400,
      height: 200,
      series: [series('gravity', 'left', 3)],
      left,
    })
    const { result } = renderHook(() => useCrosshair(model, 'gravity'))
    act(() => result.current.handlers.onPointerMove(ptr(200)))
    expect(result.current.active).toBe(true)
    act(() => result.current.handlers.onPointerCancel())
    expect(result.current.active).toBe(false)
    expect(result.current.index).toBeNull()
  })
})
