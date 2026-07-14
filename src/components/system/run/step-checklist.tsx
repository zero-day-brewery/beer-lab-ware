'use client'
import type { JSX } from 'react'
import type { ProcessStep } from '@/lib/brewing/process/types'
import type { StepRenderProps } from './step-recipe-value'

export function checklistComplete(step: ProcessStep, checked: Record<string, boolean>): boolean {
  return step.logs
    .filter((f) => f.kind === 'bool' && f.required === true)
    .every((f) => checked[f.key] === true)
}

export interface ChecklistProps extends StepRenderProps {
  checked: Record<string, boolean>
  onLog: (field: string, value: boolean) => void
}

export function StepChecklist({ step, checked, onLog }: ChecklistProps): JSX.Element {
  const items = step.logs.filter((f) => f.kind === 'bool')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{step.body_md}</p>
      <ul className="flex flex-col gap-2">
        {items.map((f) => (
          <li key={f.key}>
            <label className="flex items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={checked[f.key] === true}
                onChange={(e) => onLog(f.key, e.target.checked)}
                style={{ width: 28, height: 28 }}
              />
              <span>
                {f.label}
                {f.required ? <span className="text-[var(--malt)]"> *</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
