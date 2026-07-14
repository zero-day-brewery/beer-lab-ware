'use client'
import type { JSX } from 'react'
import { RefractometerHelper } from '@/components/system/refractometer-helper'
import type { LogField, LogFieldKind, ProcessStep } from '@/lib/brewing/process/types'
import type { ResolveCtx } from '@/lib/brewing/process/values'
import { injectValues } from '@/lib/brewing/process/values'
import { deltaTone } from './step-log-delta'

// Re-export so callers can import from here if needed
export type { LogField }

const INCREMENT: Record<LogFieldKind, number> = {
  gravity: 0.001,
  temp: 0.5,
  number: 5,
  time: 1,
  text: 0,
  bool: 0,
}

const PRECISION: Record<LogFieldKind, number> = {
  gravity: 3,
  temp: 1,
  number: 0,
  time: 0,
  text: 0,
  bool: 0,
}

function resolveFieldTarget(
  field: LogField,
  step: ProcessStep,
  ctx: ResolveCtx,
): number | undefined {
  const targetKey = field.targetValueKey
  if (!targetKey) return undefined
  const valueToken = step.values.find((v) => v.key === targetKey) ?? {
    key: targetKey,
    label: field.label,
    source: 'calc' as const,
  }
  const resolved = injectValues(valueToken, ctx)
  return typeof resolved.value === 'number' ? resolved.value : undefined
}

export interface StepLogFieldsProps {
  step: ProcessStep
  logged: Record<string, string | number | boolean>
  ctx: ResolveCtx
  onChange: (key: string, value: string | number | boolean) => void
}

/**
 * Renders the per-field inputs for a step's logFields.
 * Extracted from StepLogDelta so it can be reused in StepTimer and StepBranchChoose.
 *
 * number/gravity/temp/time → stepper with ± buttons
 * bool → checkbox
 * text → text input
 * Required fields are marked with *.
 */
export function StepLogFields({ step, logged, ctx, onChange }: StepLogFieldsProps): JSX.Element {
  const numericKinds: LogFieldKind[] = ['number', 'gravity', 'temp', 'time']

  return (
    <div className="flex flex-col gap-4">
      {step.logs.map((field) => {
        const kind = field.kind as LogFieldKind

        if (field.kind === 'bool') {
          const boolVal = (logged[field.key] as boolean | undefined) ?? false
          return (
            <div key={field.key} className="flex items-center gap-3">
              <input
                id={`gs-bool-${field.key}`}
                type="checkbox"
                className="gs-log-checkbox"
                checked={boolVal}
                onChange={(e) => onChange(field.key, e.target.checked)}
              />
              <label htmlFor={`gs-bool-${field.key}`} className="text-sm">
                {field.label}
                {field.required && <span className="ml-1 text-destructive">*</span>}
              </label>
            </div>
          )
        }

        if (field.kind === 'text') {
          const textVal = (logged[field.key] as string | undefined) ?? ''
          return (
            <div key={field.key} className="flex flex-col gap-1">
              <label
                htmlFor={`gs-text-${field.key}`}
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {field.label}
                {field.required && <span className="ml-1 text-destructive">*</span>}
              </label>
              <input
                id={`gs-text-${field.key}`}
                type="text"
                className="gs-log-text"
                value={textVal}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            </div>
          )
        }

        if (numericKinds.includes(kind)) {
          const resolvedTarget = resolveFieldTarget(field, step, ctx)
          const loggedVal = logged[field.key] as number | undefined
          const inc = INCREMENT[kind]
          const prec = PRECISION[kind]
          const cur = loggedVal ?? resolvedTarget ?? 0
          const round = (n: number) => Number(n.toFixed(prec + 2))
          const delta =
            loggedVal != null && resolvedTarget != null ? loggedVal - resolvedTarget : null
          const isGravity = kind === 'gravity'

          return (
            <div key={field.key} className="flex flex-col gap-2">
              {resolvedTarget != null && (
                <div className="text-sm text-muted-foreground">
                  Target{' '}
                  <b className="text-foreground">
                    {resolvedTarget.toFixed(prec)}
                    {field.unit ? ` ${field.unit}` : ''}
                  </b>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {field.label}
                  {field.required && <span className="ml-1 text-destructive">*</span>}
                </span>
                <div className="gs-stepper">
                  <button
                    type="button"
                    className="gs-stepper-btn"
                    aria-label={`${field.key}-decrement`}
                    onClick={() => onChange(field.key, round(cur - inc))}
                  >
                    −
                  </button>
                  <span className="gs-stepper-val">{cur.toFixed(prec)}</span>
                  <button
                    type="button"
                    className="gs-stepper-btn"
                    aria-label={`${field.key}-increment`}
                    onClick={() => onChange(field.key, round(cur + inc))}
                  >
                    +
                  </button>
                </div>
                {delta != null && (
                  <span
                    data-testid={`gs-delta-${field.key}`}
                    className={`gs-delta ${deltaTone(delta, kind)}`}
                  >
                    Δ {delta >= 0 ? '+' : ''}
                    {delta.toFixed(prec)}
                  </span>
                )}
              </div>
              {isGravity && (
                <RefractometerHelper
                  og={undefined}
                  onApply={(sg) => onChange(field.key, round(sg))}
                />
              )}
            </div>
          )
        }

        return null
      })}
    </div>
  )
}
