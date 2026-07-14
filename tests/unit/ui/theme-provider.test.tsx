// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '@/components/shell/theme-provider'

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('renders children', () => {
    render(
      <ThemeProvider>
        <div>kid</div>
      </ThemeProvider>,
    )
    expect(screen.getByText('kid')).toBeInTheDocument()
  })

  it('exposes current theme via useTheme()', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    })
    // metal-cyberpunk is the app default (set 2026-07-04 restyle).
    expect(result.current.theme).toBe('metal-cyberpunk')
  })

  it('setTheme updates the active theme + persists', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    })
    act(() => {
      result.current.setTheme('matrix')
    })
    expect(result.current.theme).toBe('matrix')
    expect(localStorage.getItem('brew-theme')).toBe('matrix')
    expect(document.documentElement.getAttribute('data-theme')).toBe('matrix')
  })

  it('initial theme reads from localStorage', () => {
    localStorage.setItem('brew-theme', 'cyberpunk')
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    })
    expect(result.current.theme).toBe('cyberpunk')
  })
})
