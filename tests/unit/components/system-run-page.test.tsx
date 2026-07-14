// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/system/run/guided-runner', () => ({
  GuidedRunner: () => <div data-testid="runner">runner</div>,
}))

import SystemRunPage from '@/app/system/run/page'

describe('SystemRunPage', () => {
  it('renders GuidedRunner inside a Suspense boundary', async () => {
    render(<SystemRunPage />)
    expect(await screen.findByTestId('runner')).toBeInTheDocument()
  })
})
