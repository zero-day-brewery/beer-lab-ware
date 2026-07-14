// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AbvCard } from '@/components/calc/calculators/abv-card'

// Wiring test: default OG 1.050 / FG 1.010 simple → calcABV → 5.25%. Then prove
// it live-recomputes: drop FG to 1.000 → 6.56%.
describe('AbvCard', () => {
  it('computes ABV from defaults and recomputes on input change', () => {
    render(<AbvCard />)
    expect(screen.getByText('5.25%')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^FG$/), { target: { value: '1.000' } })
    expect(screen.getByText('6.56%')).toBeInTheDocument()
  })
})
