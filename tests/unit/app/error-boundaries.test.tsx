// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RouteError from '@/app/error'
import GlobalError from '@/app/global-error'
import NotFound from '@/app/not-found'

const recordError = vi.fn()
vi.mock('@/lib/diagnostics/error-log', () => ({
  recordError: (...args: unknown[]) => recordError(...args),
  getDiagnostics: () => ({ appVersion: '0.0.0-dev', verno: 8, ring: [], userAgent: '' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('error boundaries', () => {
  afterEach(() => vi.clearAllMocks())

  it('error.tsx records the error and Try again calls reset', () => {
    const reset = vi.fn()
    render(<RouteError error={new Error('render-boom')} reset={reset} />)
    expect(recordError).toHaveBeenCalledWith('route', expect.any(Error))
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /recipes/i })).toHaveAttribute('href', '/recipes/')
  })

  it('global-error.tsx records + renders a reset control', () => {
    const reset = vi.fn()
    render(<GlobalError error={new Error('global-boom')} reset={reset} />)
    expect(recordError).toHaveBeenCalledWith('global', expect.any(Error))
    fireEvent.click(screen.getByRole('button', { name: /reload|try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('not-found.tsx renders a 404 message and a link back to recipes', () => {
    render(<NotFound />)
    expect(screen.getByText(/not found/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /recipes/i })).toHaveAttribute('href', '/recipes/')
  })
})
