'use client'
import type { JSX } from 'react'
import type { ProcessStep } from '@/lib/brewing/process/types'
import { injectValues } from '@/lib/brewing/process/values'

export type ValueCtx = Parameters<typeof injectValues>[1]

export interface StepRenderProps {
  step: ProcessStep
  ctx: ValueCtx
}

export function StepRecipeValue({ step, ctx }: StepRenderProps): JSX.Element {
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
            return (
              <div key={`${token.key}-${token.index ?? 0}`} className="flex flex-col items-center">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {token.label}
                </span>
                <span className={`gs-hero${resolved ? '' : ' unresolved'}`}>
                  {r.display}
                  {resolved && token.unit ? <span className="text-base"> {token.unit}</span> : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
