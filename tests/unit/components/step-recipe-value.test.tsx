// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Phase-1 resolver is mocked so this renderer test stays isolated from the value engine.
// Uses the REAL ResolvedValue shape: { value: number | string | null; display: string }
vi.mock('@/lib/brewing/process/values', () => ({
  injectValues: (t: { key: string }) =>
    t.key === 'strikeTemp_C' ? { value: 73.3, display: '73.3' } : { value: null, display: '—' },
}))

import { StepRecipeValue } from '@/components/system/run/step-recipe-value'

afterEach(() => vi.restoreAllMocks())

const step = {
  id: 'read-batch-numbers',
  title: 'Read & write down batch numbers',
  body_md: 'Capture strike temp on a card.',
  safety_md: 'Hot liquid — use gloves.',
  values: [
    { key: 'strikeTemp_C', label: 'Strike temp', unit: '°C', source: 'calc' },
    { key: 'mashWater_L', label: 'Strike volume', unit: 'L', source: 'calc' },
  ],
  logs: [],
  timers: [],
} as unknown as Parameters<typeof StepRecipeValue>[0]['step']

describe('StepRecipeValue', () => {
  it('renders resolved values and labels', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    expect(screen.getByText('73.3')).toBeInTheDocument()
    expect(screen.getByText(/Strike temp/)).toBeInTheDocument()
  })

  it('shows the graceful — fallback for unresolved values', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('does NOT render the step title (GuidedRunner owns it — avoids the duplicate-title bug)', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    expect(screen.queryByText(/Read & write down batch numbers/)).not.toBeInTheDocument()
  })

  it('renders the step body markdown text', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    expect(screen.getByText(/Capture strike temp on a card/)).toBeInTheDocument()
  })

  it('does NOT render safety text (GuidedRunner owns the pinned safety banner)', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    expect(screen.queryByText(/Hot liquid/)).not.toBeInTheDocument()
  })

  it('applies gs-hero class to value display elements', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    const heroElements = document.querySelectorAll('.gs-hero')
    expect(heroElements.length).toBeGreaterThan(0)
  })

  it('applies unresolved style when value is null', () => {
    render(<StepRecipeValue step={step} ctx={{}} />)
    // The dash fallback should have the unresolved class
    const unresolved = document.querySelectorAll('.gs-hero.unresolved')
    expect(unresolved.length).toBeGreaterThan(0)
  })
})
