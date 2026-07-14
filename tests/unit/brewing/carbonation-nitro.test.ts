import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nitroPlan } from '@/lib/brewing/carbonation/nitro'

describe('nitroPlan', () => {
  it('defaults to 75/25 blend, 30 psi dispense, low CO2 vol, PRV ≥ 65', () => {
    const p = nitroPlan({})
    expect(p.blend).toBe('75/25')
    expect(p.dispense_psi).toBe(30)
    expect(p.dispense_psi).toBeGreaterThanOrEqual(25)
    expect(p.dispense_psi).toBeLessThanOrEqual(35)
    expect(p.lowCo2Vol).toBeGreaterThanOrEqual(1.2)
    expect(p.lowCo2Vol).toBeLessThanOrEqual(1.5)
    expect(p.minPrvRating_psi).toBeGreaterThanOrEqual(65)
  })

  it('returns a plan for a named style too (style is advisory only)', () => {
    const p = nitroPlan({ style: 'Dry Stout' })
    expect(p.dispense_psi).toBe(30)
    expect(p.minPrvRating_psi).toBeGreaterThanOrEqual(65)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/carbonation/nitro.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
