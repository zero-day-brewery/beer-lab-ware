'use client'
import { type KeyboardEvent, type PointerEvent, useMemo, useState } from 'react'
import { nearestByTime } from '@/lib/brewing/charts/nearest'
import type { ChartModel, RenderSeries } from '@/lib/brewing/charts/types'

export interface CrosshairApi {
  active: boolean
  index: number | null
  primaryId: string | null
  handlers: {
    onPointerMove: (e: PointerEvent<Element>) => void
    onPointerDown: (e: PointerEvent<Element>) => void
    onPointerLeave: () => void
    onPointerCancel: () => void
    onKeyDown: (e: KeyboardEvent<Element>) => void
  }
}

/** preferredId if non-empty, else the first non-empty series, else null. */
function resolvePrimary(model: ChartModel, preferredId: string): RenderSeries | null {
  const preferred = model.series.find((s) => s.id === preferredId)
  if (preferred && preferred.points.length > 0) return preferred
  return model.series.find((s) => s.points.length > 0) ?? null
}

const NOOP = () => {}

export function useCrosshair(model: ChartModel, preferredId: string): CrosshairApi {
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState<number | null>(null)
  const primary = useMemo(() => resolvePrimary(model, preferredId), [model, preferredId])

  if (!primary) {
    return {
      active: false,
      index: null,
      primaryId: null,
      handlers: {
        onPointerMove: NOOP,
        onPointerDown: NOOP,
        onPointerLeave: NOOP,
        onPointerCancel: NOOP,
        onKeyDown: NOOP,
      },
    }
  }

  const pts = primary.points.map((p) => p.point)

  const locate = (e: PointerEvent<Element>) => {
    // Recompute the rect at event time — Safari shifts it under momentum scroll.
    // The capture <rect> is rendered INSIDE <g translate(inner.x, inner.y)>, so its
    // screen rect.left already includes inner.x. Subtracting inner.x again would shift
    // every hit ~inner.x px to the left. px is therefore inner-relative already, which
    // is exactly what model.pxToT expects.
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = pts.length === 1 ? 0 : (nearestByTime(pts, model.pxToT(px)) ?? 0)
    setIndex(i)
    setActive(true)
  }

  const clear = () => {
    setActive(false)
    setIndex(null)
  }

  return {
    active,
    index,
    primaryId: primary.id,
    handlers: {
      onPointerMove: locate,
      onPointerDown: (e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // best-effort; some engines/tests lack setPointerCapture
        }
        locate(e)
      },
      onPointerLeave: clear,
      onPointerCancel: clear,
      onKeyDown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        setActive(true)
        setIndex((cur) => {
          const start = cur ?? 0
          const next = e.key === 'ArrowRight' ? start + 1 : start - 1
          return Math.max(0, Math.min(pts.length - 1, next))
        })
      },
    },
  }
}
