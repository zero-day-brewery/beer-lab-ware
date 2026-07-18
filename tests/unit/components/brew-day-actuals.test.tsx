// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}))

import { BrewDayActuals } from '@/components/recipe/recipe-detail-view'

describe('BrewDayActuals (print-only brew sheet block)', () => {
  it('is screen-hidden (`hidden`) and print-visible (`print:block`)', () => {
    render(<BrewDayActuals />)
    const section = screen.getByTestId('brew-day-actuals')
    expect(section.className).toContain('hidden')
    expect(section.className).toContain('print:block')
  })

  it('renders blank ruled rows for the brew-day measurements', () => {
    render(<BrewDayActuals />)
    expect(screen.getByText('Mash pH')).toBeInTheDocument()
    expect(screen.getByText('Pre-boil gravity')).toBeInTheDocument()
    expect(screen.getByText('Original gravity (OG)')).toBeInTheDocument()
    expect(screen.getByText('Final gravity (FG)')).toBeInTheDocument()
    // Every row carries a ruled blank to write on.
    expect(document.querySelectorAll('.print-blank')).toHaveLength(5)
  })
})
