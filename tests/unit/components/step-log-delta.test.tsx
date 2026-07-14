// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { deltaTone, StepLogDelta } from '@/components/system/run/step-log-delta'

describe('deltaTone', () => {
  it('gravity: tight delta is go, moderate is warn, large is brick', () => {
    expect(deltaTone(0.002, 'gravity')).toBe('go')
    expect(deltaTone(0.006, 'gravity')).toBe('warn')
    expect(deltaTone(0.02, 'gravity')).toBe('brick')
  })
  it('temp: ±1 go, ±3 warn, beyond brick', () => {
    expect(deltaTone(0.5, 'temp')).toBe('go')
    expect(deltaTone(2, 'temp')).toBe('warn')
    expect(deltaTone(6, 'temp')).toBe('brick')
  })
  it('gravity: exact boundaries — 0.003 is go, 0.003+ε is warn, 0.008 is warn, 0.008+ε is brick', () => {
    expect(deltaTone(0.003, 'gravity')).toBe('go')
    expect(deltaTone(0.0031, 'gravity')).toBe('warn')
    expect(deltaTone(0.008, 'gravity')).toBe('warn')
    expect(deltaTone(0.0081, 'gravity')).toBe('brick')
  })
  it('gravity: negative deltas use absolute value', () => {
    expect(deltaTone(-0.002, 'gravity')).toBe('go')
    expect(deltaTone(-0.006, 'gravity')).toBe('warn')
    expect(deltaTone(-0.02, 'gravity')).toBe('brick')
  })
  it('temp: exact boundaries — 1 is go, 1+ε is warn, 3 is warn, 3+ε is brick', () => {
    expect(deltaTone(1, 'temp')).toBe('go')
    expect(deltaTone(1.1, 'temp')).toBe('warn')
    expect(deltaTone(3, 'temp')).toBe('warn')
    expect(deltaTone(3.1, 'temp')).toBe('brick')
  })
  it('temp: negative deltas use absolute value', () => {
    expect(deltaTone(-0.5, 'temp')).toBe('go')
    expect(deltaTone(-2, 'temp')).toBe('warn')
    expect(deltaTone(-6, 'temp')).toBe('brick')
  })
  it('default (number/time/text): ±5% relative go, ±12% warn, beyond brick', () => {
    expect(deltaTone(4, 'number')).toBe('go')
    expect(deltaTone(5, 'number')).toBe('go')
    expect(deltaTone(6, 'number')).toBe('warn')
    expect(deltaTone(12, 'number')).toBe('warn')
    expect(deltaTone(13, 'number')).toBe('brick')
    expect(deltaTone(-4, 'number')).toBe('go')
    expect(deltaTone(-13, 'number')).toBe('brick')
  })
})

const step = {
  id: 'log-gravity',
  title: 'Log a gravity reading',
  body_md: 'Read SG.',
  values: [],
  logs: [
    { key: 'sg', label: 'Your SG', kind: 'gravity', required: true, targetValueKey: 'targetFG' },
  ],
  timers: [],
} as unknown as Parameters<typeof StepLogDelta>[0]['step']

describe('StepLogDelta', () => {
  it('renders the Δ chip with the correct tone vs target', () => {
    render(
      <StepLogDelta
        step={step}
        ctx={{ calc: { FG: 1.012 } as never }}
        logged={{ sg: 1.014 }}
        onChange={vi.fn()}
      />,
    )
    const chip = screen.getByTestId('gs-delta-sg')
    expect(chip.className).toContain('go')
    expect(chip.textContent).toContain('+0.002')
  })
  it('+ stepper increments by the gravity increment 0.001', async () => {
    const onChange = vi.fn()
    render(<StepLogDelta step={step} ctx={{}} logged={{ sg: 1.014 }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'sg-increment' }))
    expect(onChange).toHaveBeenCalledWith('sg', 1.015)
  })
  it('renders target value when provided', () => {
    render(
      <StepLogDelta
        step={step}
        ctx={{ calc: { FG: 1.012 } as never }}
        logged={{ sg: 1.014 }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/1\.012/)).toBeTruthy()
  })
  it('− stepper decrements by gravity increment 0.001', async () => {
    const onChange = vi.fn()
    render(<StepLogDelta step={step} ctx={{}} logged={{ sg: 1.014 }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'sg-decrement' }))
    expect(onChange).toHaveBeenCalledWith('sg', 1.013)
  })
  it('chip shows warn tone when delta is 0.006 (gravity)', () => {
    render(
      <StepLogDelta
        step={step}
        ctx={{ calc: { FG: 1.01 } as never }}
        logged={{ sg: 1.016 }}
        onChange={vi.fn()}
      />,
    )
    const chip = screen.getByTestId('gs-delta-sg')
    expect(chip.className).toContain('warn')
  })
  it('chip shows brick tone when delta is large (gravity)', () => {
    render(
      <StepLogDelta
        step={step}
        ctx={{ calc: { FG: 1.01 } as never }}
        logged={{ sg: 1.025 }}
        onChange={vi.fn()}
      />,
    )
    const chip = screen.getByTestId('gs-delta-sg')
    expect(chip.className).toContain('brick')
  })
  it('does not render Δ chip when no target provided', () => {
    render(<StepLogDelta step={step} ctx={{}} logged={{ sg: 1.014 }} onChange={vi.fn()} />)
    expect(screen.queryByTestId('gs-delta-sg')).toBeNull()
  })
  it('renders RefractometerHelper toggle for gravity fields', () => {
    render(<StepLogDelta step={step} ctx={{}} logged={{ sg: 1.014 }} onChange={vi.fn()} />)
    expect(screen.getByText(/Refractometer/i)).toBeTruthy()
  })
})

// ── New tests: multi-field rendering (C2/C3) ────────────────────────────────

describe('StepLogDelta — multi-field rendering (C2/C3)', () => {
  /** Mirroring the BREW_MANUAL read-batch-numbers step pattern: 3 required numeric logs. */
  const threeNumericStep = {
    id: 'read-batch-numbers',
    title: 'Read batch numbers',
    body_md: 'Record pre-brew vitals.',
    values: [],
    logs: [
      { key: 'vol', label: 'Volume (L)', kind: 'number', required: true },
      { key: 'temp', label: 'Strike Temp (°C)', kind: 'temp', required: true },
      { key: 'ph', label: 'Mash pH', kind: 'number', required: true },
    ],
    timers: [],
  } as unknown as Parameters<typeof StepLogDelta>[0]['step']

  it('(a) renders 3 steppers for a step with 3 required numeric logs', () => {
    render(<StepLogDelta step={threeNumericStep} ctx={{}} logged={{}} onChange={vi.fn()} />)
    // Each stepper has an increment button labelled `${key}-increment`
    expect(screen.getByRole('button', { name: 'vol-increment' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'temp-increment' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ph-increment' })).toBeTruthy()
  })

  it('(a) onChange is called with the correct per-field key when stepping each field (c)', async () => {
    const onChange = vi.fn()
    render(
      <StepLogDelta
        step={threeNumericStep}
        ctx={{}}
        logged={{ vol: 20, temp: 70, ph: 5.4 }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'vol-increment' }))
    expect(onChange).toHaveBeenCalledWith('vol', 25)

    await userEvent.click(screen.getByRole('button', { name: 'temp-increment' }))
    expect(onChange).toHaveBeenCalledWith('temp', 70.5)

    await userEvent.click(screen.getByRole('button', { name: 'ph-increment' }))
    expect(onChange).toHaveBeenCalledWith('ph', 10.4)
  })

  /** Simulates the weigh-grain step: required bool (sanitized) + required number (weight). */
  const boolPlusNumericStep = {
    id: 'weigh-grain',
    title: 'Weigh grain',
    body_md: 'Sanitize and weigh.',
    values: [],
    logs: [
      { key: 'sanitized', label: 'Equipment sanitized', kind: 'bool', required: true },
      { key: 'weight', label: 'Grain weight (kg)', kind: 'number', required: true },
    ],
    timers: [],
  } as unknown as Parameters<typeof StepLogDelta>[0]['step']

  it('(b) renders both a checkbox and a stepper for bool + number fields', () => {
    render(<StepLogDelta step={boolPlusNumericStep} ctx={{}} logged={{}} onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'weight-increment' })).toBeTruthy()
  })

  it('(c) onChange fires with correct key for bool field checkbox', async () => {
    const onChange = vi.fn()
    render(
      <StepLogDelta
        step={boolPlusNumericStep}
        ctx={{}}
        logged={{ sanitized: false, weight: 0 }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith('sanitized', true)
  })
})
