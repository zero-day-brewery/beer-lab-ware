// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('RTL sanity', () => {
  it('renders text', () => {
    render(<div>hello world</div>)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })
})
