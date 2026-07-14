'use client'
import type { JSX } from 'react'
import type { LogFieldKind } from '@/lib/brewing/process/types'
import { StepLogFields } from './step-log-fields'
import type { StepRenderProps } from './step-recipe-value'

export type DeltaTone = 'go' | 'warn' | 'brick'

export function deltaTone(delta: number, kind: LogFieldKind): DeltaTone {
  const a = Math.abs(delta)
  if (kind === 'gravity') return a <= 0.003 ? 'go' : a <= 0.008 ? 'warn' : 'brick'
  if (kind === 'temp') return a <= 1 ? 'go' : a <= 3 ? 'warn' : 'brick'
  return a <= 5 ? 'go' : a <= 12 ? 'warn' : 'brick'
}

export interface LogDeltaProps extends StepRenderProps {
  /** @deprecated Pass logged + ctx instead; target/value are now resolved per-field */
  target?: number
  /** @deprecated Pass logged + ctx instead; target/value are now resolved per-field */
  value?: number
  /** Map of field key → logged value. Used to look up the current value per field. */
  logged?: Record<string, unknown>
  onChange: (field: string, value: number | boolean | string) => void
}

/**
 * Renders a step's body text + all log fields (numeric steppers, bool checkboxes, text inputs).
 *
 * Field rendering is delegated to StepLogFields, which is also reused by StepTimer and
 * StepBranchChoose so every renderer kind gets an identical log-input UI.
 */
export function StepLogDelta({ step, ctx, logged, onChange }: LogDeltaProps): JSX.Element {
  // Normalise logged to the shape StepLogFields expects.
  // The legacy `target`/`value` props are no longer forwarded — all targets are
  // resolved per-field via targetValueKey inside StepLogFields.
  const normalisedLogged: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(logged ?? {})) {
    if (v !== undefined && v !== null) {
      normalisedLogged[k] = v as string | number | boolean
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{step.body_md}</p>
      <StepLogFields step={step} logged={normalisedLogged} ctx={ctx ?? {}} onChange={onChange} />
    </div>
  )
}
