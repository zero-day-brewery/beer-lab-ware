import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcSpunding } from '@/lib/brewing/carbonation/spunding'

describe('calcSpunding', () => {
  it('12°C, 2.5 vol → ~20 psi (within the 18–23 band)', () => {
    const r = calcSpunding({ targetVol: 2.5, fermTemp_C: 12, mawp_psi: 35 })
    expect(r.setpoint_psi).toBeGreaterThanOrEqual(18)
    expect(r.setpoint_psi).toBeLessThanOrEqual(23)
    expect(r.setpoint_psi).toBeCloseTo(20, 0)
    expect(r.cappedToMawp).toBe(false)
    expect(r.finishColdInKeg).toBe(false)
  })

  it('12°C carbonation band 2.4–2.7 vol lands 18–23 psi', () => {
    expect(
      calcSpunding({ targetVol: 2.4, fermTemp_C: 12, mawp_psi: 35 }).setpoint_psi,
    ).toBeGreaterThanOrEqual(18)
    expect(
      calcSpunding({ targetVol: 2.7, fermTemp_C: 12, mawp_psi: 35 }).setpoint_psi,
    ).toBeLessThanOrEqual(23)
  })

  it('caps to MAWP and flags finish-cold-in-keg when required psi exceeds MAWP', () => {
    const r = calcSpunding({ targetVol: 2.7, fermTemp_C: 12, mawp_psi: 15 })
    expect(r.cappedToMawp).toBe(true)
    expect(r.setpoint_psi).toBe(15)
    expect(r.finishColdInKeg).toBe(true)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/carbonation/spunding.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
