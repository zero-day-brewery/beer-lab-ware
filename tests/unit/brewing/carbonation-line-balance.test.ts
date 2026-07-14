import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { balancedLineLength_ft } from '@/lib/brewing/carbonation/line-balance'

describe('balancedLineLength_ft', () => {
  it('12 psi at default 2 psi/ft → 6 ft', () => {
    expect(balancedLineLength_ft({ servingPsi: 12 })).toBeCloseTo(6, 5)
  })

  it('lower resistance (real 3/16" ≈ 1.5 psi/ft) → longer run', () => {
    const nominal = balancedLineLength_ft({ servingPsi: 12 }) // 2 psi/ft
    const real = balancedLineLength_ft({ servingPsi: 12, resistance_psiPerFt: 1.5 })
    expect(real).toBeGreaterThan(nominal)
    expect(real).toBeCloseTo(8, 5)
  })

  it('zero serving pressure → zero length', () => {
    expect(balancedLineLength_ft({ servingPsi: 0 })).toBe(0)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/carbonation/line-balance.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
