import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { residualCo2Vol } from '@/lib/brewing/carbonation/residual-co2'

describe('residualCo2Vol', () => {
  it('crashed beer holds MORE residual CO2 than warm beer at the same spund pressure', () => {
    const warm = residualCo2Vol({ spundSetpoint_psi: 12, crashTemp_C: 18 })
    const crashed = residualCo2Vol({ spundSetpoint_psi: 12, crashTemp_C: 1 })
    expect(crashed).toBeGreaterThan(warm)
  })

  it('typical 12 psi spund, crashed to 1°C lands in a sane brewing range', () => {
    const v = residualCo2Vol({ spundSetpoint_psi: 12, crashTemp_C: 1 })
    expect(v).toBeGreaterThan(2.0)
    expect(v).toBeLessThan(3.5)
  })

  it('higher spund pressure leaves more residual CO2', () => {
    const lo = residualCo2Vol({ spundSetpoint_psi: 5, crashTemp_C: 1 })
    const hi = residualCo2Vol({ spundSetpoint_psi: 20, crashTemp_C: 1 })
    expect(hi).toBeGreaterThan(lo)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/carbonation/residual-co2.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
