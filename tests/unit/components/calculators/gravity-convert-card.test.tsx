// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GravityConvertCard } from '@/components/calc/calculators/gravity-convert-card'

// Wiring test: default SG 1.050 → sgToPlato → 12.4 °P (and echoes SG 1.050).
describe('GravityConvertCard', () => {
  it('derives Plato/Brix from the default SG input', () => {
    render(<GravityConvertCard />)
    expect(screen.getByText('1.050')).toBeInTheDocument()
    expect(screen.getByText('12.4 °P')).toBeInTheDocument()
    expect(screen.getByText('12.4 °Bx')).toBeInTheDocument()
  })
})
