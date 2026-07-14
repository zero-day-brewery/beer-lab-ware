// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CarbonationCard } from '@/components/calc/calculators/carbonation-card'

// Wiring test: the three sub-sections each feed their engine on default inputs —
// force carb 2.4 vol @ 4°C → ~10.7 psi; spunding 2.4 vol @ 12°C, 30 MAWP →
// ~18.3 psi; line balance 11 psi ÷ 2 psi/ft → 5.5 ft.
describe('CarbonationCard', () => {
  it('computes force / spunding / line-balance from defaults', () => {
    render(<CarbonationCard />)
    expect(screen.getByText('10.7 psi')).toBeInTheDocument()
    expect(screen.getByText('18.3 psi')).toBeInTheDocument()
    expect(screen.getByText('5.5 ft')).toBeInTheDocument()
  })
})
