'use client'
import type { JSX } from 'react'
import { useDisplayUnits } from '@/hooks/use-display-units'
import { formatAmount, kindForMetricUnit, unitLabel } from '@/lib/brewing/convert/display-units'
import type { ProcessStep } from '@/lib/brewing/process/types'
import { injectValues } from '@/lib/brewing/process/values'
import type { Units } from '@/lib/brewing/types/settings'

export type ValueCtx = Parameters<typeof injectValues>[1]

export interface StepRenderProps {
  step: ProcessStep
  ctx: ValueCtx
}

/**
 * Value tokens resolve CANONICAL metric numbers with a metric unit label
 * ('L', '°C', …). In imperial mode, convertible tokens are re-rendered in the
 * user's units at the token's precision; everything else (psi, min, g, %,
 * unresolved '—') passes through untouched. Metric mode renders the resolver's
 * display byte-identically to before.
 */
function displayFor(
  r: ReturnType<typeof injectValues>,
  token: ProcessStep['values'][number],
  units: Units,
): { body: string; unit: string | undefined } {
  const kind = units === 'imperial' ? kindForMetricUnit(token.unit) : null
  if (kind !== null && typeof r.value === 'number') {
    return {
      body: formatAmount(r.value, kind, units, token.precision ?? 0),
      unit: unitLabel(kind, units),
    }
  }
  return { body: r.display, unit: token.unit }
}

export function StepRecipeValue({ step, ctx }: StepRenderProps): JSX.Element {
  const units = useDisplayUnits()
  // NOTE: title + safety are rendered once by GuidedRunner as shared chrome.
  // This renderer intentionally shows only the step-specific body + values —
  // rendering them here again caused the duplicate-title/safety bug.
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{step.body_md}</p>

      {step.values.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {step.values.map((token) => {
            const r = injectValues(token, ctx)
            const resolved = r.value !== null
            const shown = displayFor(r, token, units)
            return (
              <div key={`${token.key}-${token.index ?? 0}`} className="flex flex-col items-center">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {token.label}
                </span>
                <span className={`gs-hero${resolved ? '' : ' unresolved'}`}>
                  {shown.body}
                  {resolved && shown.unit ? <span className="text-base"> {shown.unit}</span> : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
