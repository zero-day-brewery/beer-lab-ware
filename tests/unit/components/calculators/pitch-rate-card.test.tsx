// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PitchRateCard } from '@/components/calc/calculators/pitch-rate-card'

// Wiring test: defaults (20 L, OG 1.050, ale) → calcPitchRate → ~186 B cells,
// ~9.3 g dry yeast. We assert the form feeds the engine, not the engine math.
describe('PitchRateCard', () => {
  it('computes cells + dry-yeast from the default inputs', () => {
    render(<PitchRateCard />)
    expect(screen.getByText('Yeast Pitch Rate')).toBeInTheDocument()
    expect(screen.getByText('186 B')).toBeInTheDocument()
    expect(screen.getByText('9.3 g')).toBeInTheDocument()
  })
})
