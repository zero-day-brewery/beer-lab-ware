import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pressureForVolumes, volumesAtPressure } from '@/lib/brewing/carbonation/co2-volumes'

describe('co2-volumes (canonical De Clerck / Henry curve)', () => {
  it('forward: ~12 psi at 4°C gives ~2.5 vol', () => {
    // 4°C = 39.2°F. (12+14.695)(0.01821 + 0.09011·e^(−(39.2−32)/43.11)) − 0.003342
    expect(volumesAtPressure(12, 4)).toBeCloseTo(2.53, 1)
  })

  it('forward: 0 psi (atmospheric headspace) is a small positive residual', () => {
    const v = volumesAtPressure(0, 4)
    expect(v).toBeGreaterThan(1.0)
    expect(v).toBeLessThan(1.7)
  })

  it('inverse round-trips forward within 0.01 psi', () => {
    const psi = pressureForVolumes(2.5, 4)
    expect(volumesAtPressure(psi, 4)).toBeCloseTo(2.5, 2)
  })

  it('warmer wort holds less CO2 at the same pressure', () => {
    expect(volumesAtPressure(12, 20)).toBeLessThan(volumesAtPressure(12, 4))
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/carbonation/co2-volumes.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
