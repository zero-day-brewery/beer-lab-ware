// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark, BrandMarkSmall } from '@/components/brand/brand-mark'

describe('BrandMark', () => {
  it('renders the 3-generation trail as decorative SVG with theme-token strokes', () => {
    const { container } = render(<BrandMark />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('focusable')).toBe('false')
    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(4)
    expect(circles[0].getAttribute('stroke')).toBe('var(--wort, var(--malt, #f59e0b))')
    expect(circles[2].getAttribute('stroke')).toBe('var(--primary, #22d3ee)')
    expect(circles[3].getAttribute('fill')).toBe('var(--foam, #fbbf24)')
  })

  it('forwards className onto the svg', () => {
    const { container } = render(<BrandMark className="probe" />)
    expect(container.querySelector('svg.probe')).not.toBeNull()
  })

  it('BrandMarkSmall drops the granddaughter (2 cells + vacuole) and honors size', () => {
    const { container } = render(<BrandMarkSmall size={16} />)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
  })
})
