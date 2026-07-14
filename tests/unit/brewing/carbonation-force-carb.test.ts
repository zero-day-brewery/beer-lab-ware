import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcForceCarb } from '@/lib/brewing/carbonation/force-carb'

describe('calcForceCarb', () => {
  it('2.4 vol @ 4°C ≈ 11 psi (set pressure, not 12)', () => {
    const { setPsi } = calcForceCarb({ targetVol: 2.4, servingTemp_C: 4 })
    expect(setPsi).toBeGreaterThanOrEqual(10)
    expect(setPsi).toBeLessThanOrEqual(12)
    expect(setPsi).toBeCloseTo(11, 0)
  })

  it('higher target needs more pressure', () => {
    const lo = calcForceCarb({ targetVol: 2.2, servingTemp_C: 4 }).setPsi
    const hi = calcForceCarb({ targetVol: 2.7, servingTemp_C: 4 }).setPsi
    expect(hi).toBeGreaterThan(lo)
  })

  it('warmer serving temp needs more pressure for the same vol', () => {
    const cold = calcForceCarb({ targetVol: 2.4, servingTemp_C: 2 }).setPsi
    const warm = calcForceCarb({ targetVol: 2.4, servingTemp_C: 10 }).setPsi
    expect(warm).toBeGreaterThan(cold)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/carbonation/force-carb.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
