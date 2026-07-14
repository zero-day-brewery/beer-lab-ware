'use client'
import { type RefObject, useEffect, useRef, useState } from 'react'

export interface UseChartSizeOpts {
  height?: number
  aspect?: number
  minWidth?: number
}

export interface ChartSize<T extends Element> {
  ref: RefObject<T | null>
  width: number
  height: number
  ready: boolean
}

/** Measure a container with a rAF-throttled ResizeObserver. SSR/first-paint
 *  safe: width starts 0 and `ready` stays false until a real width arrives. */
export function useChartSize<T extends Element>(opts?: UseChartSizeOpts): ChartSize<T> {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(w))
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const minWidth = opts?.minWidth ?? 0
  const measured = Math.max(width, minWidth)
  const height = opts?.aspect ? Math.round(measured / opts.aspect) : (opts?.height ?? 220)
  return { ref, width: measured, height, ready: width > 0 }
}
