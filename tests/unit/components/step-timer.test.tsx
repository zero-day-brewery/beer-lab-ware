// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-alarm', () => ({
  useAlarm: () => ({ fire: vi.fn(), supported: { audio: false, vibrate: false } }),
}))

import { boilMasterAlarms, formatRemaining, StepTimer } from '@/components/system/run/step-timer'

describe('formatRemaining', () => {
  it('formats MM:SS and clamps at zero', () => {
    expect(formatRemaining(3_600_000)).toBe('60:00')
    expect(formatRemaining(90_000)).toBe('1:30')
    expect(formatRemaining(-5_000)).toBe('0:00')
  })
})

describe('boilMasterAlarms', () => {
  it('schedules boil hops as alarms at (boilMinutes - time_min), earliest first', () => {
    const hops = [
      { snapshot: { name: 'Citra' }, amount_g: 28, time_min: 60, use: 'boil' },
      { snapshot: { name: 'Mosaic' }, amount_g: 28, time_min: 10, use: 'boil' },
      { snapshot: { name: 'Dry Citra' }, amount_g: 56, time_min: 0, use: 'dry-hop' },
    ]
    const a = boilMasterAlarms(hops, 60)
    expect(a).toEqual([
      { label: 'Citra 28 g @ 60', atMinute: 0 },
      { label: 'Mosaic 28 g @ 10', atMinute: 50 },
    ])
  })
})

const step = {
  id: 'ramp-to-boil',
  title: 'Ramp to a rolling boil',
  body_md: 'Bring to boil.',
  values: [],
  logs: [],
  timers: [
    {
      id: 'boil',
      label: 'Boil timer',
      durationFrom: { kind: 'recipe', path: 'boilTime_min' },
      isBoilMaster: true,
    },
  ],
} as unknown as Parameters<typeof StepTimer>[0]['step']

describe('StepTimer', () => {
  it('shows the remaining time in the hero when armed', () => {
    const now = 1_000_000
    render(
      <StepTimer
        step={step}
        ctx={{}}
        fireAt={new Date(now + 3_600_000).toISOString()}
        now={now}
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByText('60:00')).toBeInTheDocument()
  })
  it('shows a Start button when not yet armed', () => {
    render(<StepTimer step={step} ctx={{}} now={1_000_000} onStart={vi.fn()} />)
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument()
  })

  // ── I1: fired timer keeps StepTimer in done state ──────────────────────
  it('(I1) shows done state when timerStatus is "fired" — NOT the Start button', () => {
    // The timer fired in the past: fireAt is 5s ago, status='fired'
    const now = 1_000_000
    const fireAt = new Date(now - 5_000).toISOString()
    render(
      <StepTimer
        step={step}
        ctx={{}}
        fireAt={fireAt}
        timerStatus="fired"
        now={now}
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByTestId('gs-timer-done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
  })

  it('(I1) shows done state from timerStatus alone even if fireAt is in the future (edge case: clock skew)', () => {
    // Shouldn't normally happen, but timerStatus='fired' takes priority
    const now = 1_000_000
    const fireAt = new Date(now + 60_000).toISOString() // still "in the future"
    render(
      <StepTimer
        step={step}
        ctx={{}}
        fireAt={fireAt}
        timerStatus="fired"
        now={now}
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByTestId('gs-timer-done')).toBeInTheDocument()
  })

  it('(I1) keeps showing countdown when timerStatus is "armed" and time remains', () => {
    const now = 1_000_000
    render(
      <StepTimer
        step={step}
        ctx={{}}
        fireAt={new Date(now + 3_600_000).toISOString()}
        timerStatus="armed"
        now={now}
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByText('60:00')).toBeInTheDocument()
    expect(screen.queryByTestId('gs-timer-done')).toBeNull()
  })
})

// ── C2: StepTimer renders StepLogFields when step has log fields + onLog provided ──

describe('StepTimer — log fields (C2)', () => {
  const stepWithLogs = {
    id: 'heat-strike-water',
    title: 'Heat strike water',
    body_md: 'Heat to strike temp.',
    values: [],
    logs: [{ key: 'strikeTemp', label: 'Strike Temp (°C)', kind: 'temp' as const, required: true }],
    timers: [
      {
        id: 'heat-timer',
        label: 'Heat',
        durationFrom: { kind: 'fixed' as const, minutes: 20 },
        isBoilMaster: false,
      },
    ],
  } as unknown as Parameters<typeof StepTimer>[0]['step']

  it('renders a stepper for the required numeric log field', () => {
    render(
      <StepTimer
        step={stepWithLogs}
        ctx={{}}
        now={1_000_000}
        onStart={vi.fn()}
        logged={{}}
        onLog={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'strikeTemp-increment' })).toBeInTheDocument()
  })

  it('does NOT render log fields when onLog is not provided', () => {
    render(<StepTimer step={stepWithLogs} ctx={{}} now={1_000_000} onStart={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'strikeTemp-increment' })).toBeNull()
  })
})
