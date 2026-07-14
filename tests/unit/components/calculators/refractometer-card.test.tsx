// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RefractometerCard } from '@/components/calc/calculators/refractometer-card'

// Wiring test: default OG 12 °Bx / FG 6 °Bx → brixToSG → correctedFG → roundSG
// → 1.012 (rendered via formatGravity, default unit 'sg').
describe('RefractometerCard', () => {
  it('computes corrected FG from the default Brix inputs', () => {
    render(<RefractometerCard />)
    expect(screen.getByText('Refractometer FG')).toBeInTheDocument()
    expect(screen.getByText('1.012')).toBeInTheDocument()
  })
})
