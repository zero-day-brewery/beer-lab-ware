// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  InventoryEmptyScene,
  LogbookEmptyScene,
  RecipesEmptyScene,
  YeastEmptyScene,
} from '@/components/brand/empty-scenes'

const SCENES = [
  ['RecipesEmptyScene', RecipesEmptyScene],
  ['InventoryEmptyScene', InventoryEmptyScene],
  ['YeastEmptyScene', YeastEmptyScene],
  ['LogbookEmptyScene', LogbookEmptyScene],
] as const

describe('empty scenes', () => {
  it.each(SCENES)('%s renders a decorative SVG bound to theme tokens', (_name, Scene) => {
    const { container } = render(<Scene />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(container.innerHTML).toContain('var(--wort, var(--malt, #f59e0b))')
  })
})
