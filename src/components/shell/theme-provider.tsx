'use client'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { Theme } from '@/lib/brewing/types/settings'

const STORAGE_KEY = 'brew-theme'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// Keep the browser chrome (PWA theme-color) in sync with the active theme's primary.
function syncThemeColor() {
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  if (!primary) return
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', primary)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('metal-cyberpunk')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    document.documentElement.setAttribute('data-theme', stored ?? 'metal-cyberpunk')
    if (stored) setThemeState(stored)
    syncThemeColor()
  }, [])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.setAttribute('data-theme', next)
    syncThemeColor()
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
