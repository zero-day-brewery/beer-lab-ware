'use client'
import { useEffect, useRef, useState } from 'react'
import { formatForInput, fromDisplay, type QuantityKind } from '@/lib/brewing/convert/display-units'
import type { Units } from '@/lib/brewing/types/settings'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * The active display-unit system from Settings ('metric' until settings load —
 * the same `settings?.units ?? 'metric'` fallback every existing consumer
 * uses). Pair with the pure helpers in convert/display-units.ts.
 */
export function useDisplayUnits(): Units {
  const { settings } = useSettingsStore()
  return settings?.units ?? 'metric'
}

/**
 * Local string-state for a calculator input that the user edits in DISPLAY
 * units while the caller computes in CANONICAL metric. Seeds from a canonical
 * default, exposes the parsed canonical value (null while empty/invalid), and
 * CONVERTS the in-progress text when the unit system flips mid-session so a
 * "67" °C field becomes "152.6" °F instead of silently changing meaning.
 */
export function useDisplayNumberState(
  canonicalDefault: number,
  kind: QuantityKind,
): {
  text: string
  setText: (v: string) => void
  canonical: number | null
  units: Units
} {
  const units = useDisplayUnits()
  const [text, setText] = useState(() => formatForInput(canonicalDefault, kind, units))
  const prevUnits = useRef(units)

  useEffect(() => {
    if (prevUnits.current === units) return
    const from = prevUnits.current
    prevUnits.current = units
    setText((cur) => {
      const n = Number(cur)
      if (cur.trim() === '' || !Number.isFinite(n)) return cur
      return formatForInput(fromDisplay(n, kind, from), kind, units)
    })
  }, [units, kind])

  const n = Number(text)
  const canonical = text.trim() !== '' && Number.isFinite(n) ? fromDisplay(n, kind, units) : null
  return { text, setText, canonical, units }
}
