'use client'
import { useEffect, useRef, useState } from 'react'
import {
  type Control,
  type FieldPath,
  type FieldValues,
  type PathValue,
  useController,
} from 'react-hook-form'
import { useDisplayUnits } from '@/hooks/use-display-units'
import {
  CANONICAL_EPSILON,
  formatForInput,
  parseInput,
  type QuantityKind,
} from '@/lib/brewing/convert/display-units'

/**
 * A react-hook-form number input that EDITS in the user's display units while
 * the FORM STATE stays canonical metric — so nothing downstream (Zod schema,
 * calc pipeline, Dexie save) ever sees a converted value.
 *
 * The visible text is local state seeded from the canonical field value.
 * Typing parses display → canonical on every keystroke (empty/invalid → NaN,
 * matching `register(..., { valueAsNumber: true })` semantics so the Zod
 * resolver behaves identically). The text resyncs from the canonical value
 * only when it changed EXTERNALLY (form.reset, scale flow) or the unit system
 * flipped — detected by comparing against CANONICAL_EPSILON so formatting
 * noise never clobbers in-progress typing.
 */
export function UnitNumberInput<T extends FieldValues>({
  control,
  name,
  kind,
  step,
  className,
  'aria-label': ariaLabel,
}: {
  control: Control<T>
  name: FieldPath<T>
  kind: QuantityKind
  step?: string
  className?: string
  'aria-label'?: string
}) {
  const units = useDisplayUnits()
  const { field } = useController({ control, name })
  const canonical =
    typeof field.value === 'number' && Number.isFinite(field.value) ? (field.value as number) : null

  const [text, setText] = useState(() =>
    canonical == null ? '' : formatForInput(canonical, kind, units),
  )
  // Ref mirror so the resync effect can read the latest text without listing it
  // as a dependency (a `text` dep would re-run — and clobber — on every keystroke).
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    if (canonical == null) return
    const parsed = parseInput(textRef.current, kind, units)
    if (parsed == null || Math.abs(parsed - canonical) > CANONICAL_EPSILON[kind]) {
      setText(formatForInput(canonical, kind, units))
    }
  }, [canonical, units, kind])

  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      name={field.name}
      ref={field.ref}
      value={text}
      aria-label={ariaLabel}
      className={className}
      onBlur={field.onBlur}
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        const parsed = parseInput(v, kind, units)
        field.onChange((parsed ?? Number.NaN) as PathValue<T, FieldPath<T>>)
      }}
    />
  )
}
