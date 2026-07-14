import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Importing `@/app/layout` pulls in `next/font/google` calls (Archivo, Fraunces,
// Hanken_Grotesk, Geist_Mono), which vitest cannot transform the way Next's build
// pipeline does — `Archivo is not a function` at import time. There's no existing
// next/font mock wired into vitest.config.ts, and adding one is out of scope for
// this task (touch nothing but layout.tsx + this test). Falling back to a
// file-text assertion per the task brief's documented fallback.
const src = readFileSync('src/app/layout.tsx', 'utf8')

describe('layout metadata', () => {
  it('tab icon prefers the small-mark 32px asset, then the full mark at 192', () => {
    expect(src).toContain("url: '/icons/favicon-32.png', sizes: '32x32'")
    expect(src).toContain("url: '/icons/icon-192.png', sizes: '192x192'")
    expect(src).toContain("apple: '/icons/apple-touch-icon.png'")

    // Assert order: favicon-32.png must come before icon-192.png
    const idx32 = src.indexOf("url: '/icons/favicon-32.png'")
    const idx192 = src.indexOf("url: '/icons/icon-192.png'")
    expect(idx32).toBeGreaterThan(-1)
    expect(idx192).toBeGreaterThan(-1)
    expect(idx32).toBeLessThan(idx192)

    // Assert both entries have type: 'image/png'
    const section32 = src.substring(
      src.indexOf("url: '/icons/favicon-32.png'"),
      src.indexOf("url: '/icons/icon-192.png'"),
    )
    expect(section32).toContain("type: 'image/png'")

    const section192 = src.substring(
      src.indexOf("url: '/icons/icon-192.png'"),
      src.indexOf("url: '/icons/icon-192.png'") + 200,
    )
    expect(section192).toContain("type: 'image/png'")
  })

  it('title carries no emoji — the favicon is the brand now', () => {
    expect(src).toContain("title: 'Beer-Lab-Ware'")
    expect(src).not.toContain('🍺')
  })
})
