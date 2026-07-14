// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DurabilityBadge } from '@/components/durability/durability-badge'

describe('DurabilityBadge', () => {
  it('renders the unsupported state when navigator.storage is absent (jsdom)', async () => {
    render(<DurabilityBadge />)
    await waitFor(() =>
      expect(screen.getByTestId('durability-badge')).toHaveAttribute('data-state', 'unsupported'),
    )
    expect(screen.getByText('Storage durability unknown')).toBeInTheDocument()
  })
})
