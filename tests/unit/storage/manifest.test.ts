import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'),
) as {
  id: string
  scope: string
  start_url: string
  background_color: string
  theme_color: string
  icons: { src: string; sizes: string; purpose: string }[]
}

describe('manifest.webmanifest', () => {
  it('uses the metal-cyberpunk near-black colors (amber-splash fixed)', () => {
    expect(manifest.background_color).toBe('#0c0f13')
    expect(manifest.theme_color).toBe('#0c0f13')
  })
  it('pins identity + scope', () => {
    expect(manifest.id).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe('/')
  })
  it('splits any + maskable purposes (no combined "any maskable")', () => {
    const purposes = manifest.icons.map((i) => i.purpose)
    expect(purposes).toContain('maskable')
    expect(purposes).toContain('any')
    expect(purposes).not.toContain('any maskable')
  })
  it('declares both maskable sizes', () => {
    const maskable = manifest.icons
      .filter((i) => i.purpose === 'maskable')
      .map((i) => i.sizes)
      .sort()
    expect(maskable).toEqual(['192x192', '512x512'])
  })
  it('maskable PNG assets exist and are non-empty', () => {
    for (const size of [192, 512]) {
      expect(
        statSync(path.resolve(process.cwd(), `public/icons/icon-maskable-${size}.png`)).size,
      ).toBeGreaterThan(0)
    }
  })
})
