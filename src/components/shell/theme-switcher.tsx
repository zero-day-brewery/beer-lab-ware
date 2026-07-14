'use client'
import type { Theme } from '@/lib/brewing/types/settings'
import { useTheme } from './theme-provider'

const THEMES: Theme[] = ['metal-cyberpunk', 'default', 'matrix', 'cyberpunk', 'neon', 'soundwave']

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Theme</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
        className="field !py-1 !text-xs"
      >
        {THEMES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  )
}
