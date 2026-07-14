// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StrikeTempCard } from '@/components/calc/calculators/strike-temp-card'

// Wiring test: default target 67°C / grain 20°C / ratio 2.6 → calcStrikeTemp
// → 74.4 °C.
describe('StrikeTempCard', () => {
  it('computes strike temp from the default inputs', () => {
    render(<StrikeTempCard />)
    expect(screen.getByText('Strike Water Temp')).toBeInTheDocument()
    expect(screen.getByText('74.4 °C')).toBeInTheDocument()
  })
})
