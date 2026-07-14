'use client'
import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { useAlarm } from '@/hooks/use-alarm'
import type { ResolveCtx } from '@/lib/brewing/process/values'
import { StepLogFields } from './step-log-fields'
import type { StepRenderProps } from './step-recipe-value'

export function formatRemaining(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

export interface HopAlarm {
  label: string
  atMinute: number
}

export function boilMasterAlarms(
  hops: { snapshot: { name: string }; amount_g: number; time_min: number; use: string }[],
  boilMinutes: number,
): HopAlarm[] {
  return hops
    .filter((h) => h.use === 'boil' || h.use === 'first-wort')
    .map((h) => ({
      label: `${h.snapshot.name} ${h.amount_g} g @ ${h.time_min}`,
      atMinute: Math.max(0, boilMinutes - h.time_min),
    }))
    .sort((a, b) => a.atMinute - b.atMinute)
}

export interface TimerProps extends StepRenderProps {
  fireAt?: string
  /** Status of the persisted timer for this step. 'fired' means the alarm already ran. */
  timerStatus?: 'armed' | 'fired'
  now: number
  recipeHops?: { snapshot: { name: string }; amount_g: number; time_min: number; use: string }[]
  boilMinutes?: number
  onStart: () => void
  /** Values already logged for the step's log fields (passed from guided-runner). */
  logged?: Record<string, string | number | boolean>
  /** Callback to log a field value (passed from guided-runner). */
  onLog?: (field: string, value: string | number | boolean) => void
}

export function StepTimer({
  step,
  ctx,
  fireAt,
  timerStatus,
  now,
  recipeHops,
  boilMinutes,
  onStart,
  logged,
  onLog,
}: TimerProps): JSX.Element {
  const { fire } = useAlarm()
  const fired = useRef(false)
  const msLeft = fireAt != null ? new Date(fireAt).getTime() - now : null
  const isBoilMaster = step.timers.some((t) => t.isBoilMaster)
  const alarms = isBoilMaster && recipeHops ? boilMasterAlarms(recipeHops, boilMinutes ?? 60) : []

  // Fire the alarm when msLeft hits zero (armed timer counting down)
  useEffect(() => {
    if (msLeft != null && msLeft <= 0 && !fired.current) {
      fired.current = true
      fire()
    }
  }, [msLeft, fire])

  // Determine display state:
  // - timerStatus === 'fired' (or msLeft <= 0 with a known fireAt): show DONE banner
  // - fireAt provided and msLeft > 0: show countdown
  // - neither: show Start button
  const isDone = timerStatus === 'fired' || (msLeft != null && msLeft <= 0)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{step.body_md}</p>
      {isDone ? (
        <div data-testid="gs-timer-done" className="gs-hero" style={{ color: 'hsl(140 55% 60%)' }}>
          ✓ Done
        </div>
      ) : msLeft != null ? (
        <div className="gs-hero">{formatRemaining(msLeft)}</div>
      ) : (
        <button type="button" className="gs-advance" onClick={onStart}>
          ✓ Start {step.timers[0]?.label ?? 'timer'}
        </button>
      )}
      {alarms.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {alarms.map((a) => (
            <li key={a.label}>
              ⏱ {a.label} (at {a.atMinute} min elapsed)
            </li>
          ))}
        </ul>
      )}
      {step.logs.length > 0 && onLog && (
        <StepLogFields step={step} logged={logged ?? {}} ctx={ctx as ResolveCtx} onChange={onLog} />
      )}
    </div>
  )
}
