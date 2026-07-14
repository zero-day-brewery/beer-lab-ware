import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPitchRate } from '@/lib/brewing/pitch/pitch-rate'

describe('calcPitchRate', () => {
  it('20 L ale @ OG 1.056 → ~207 B cells (rate 0.75)', () => {
    const r = calcPitchRate({ batchSize_L: 20, og: 1.056, style: 'ale' })
    expect(r.rate_M_per_mL_per_P).toBe(0.75)
    expect(r.cells_B).toBeCloseTo(207, 0)
  })

  it('20 L ale @ OG 1.059 → ~220 B cells', () => {
    const r = calcPitchRate({ batchSize_L: 20, og: 1.059, style: 'ale' })
    expect(r.cells_B).toBeGreaterThan(215)
    expect(r.cells_B).toBeLessThan(225)
  })

  it('lager uses rate 1.5 → roughly double the ale cell count', () => {
    const ale = calcPitchRate({ batchSize_L: 20, og: 1.05, style: 'ale' })
    const lager = calcPitchRate({ batchSize_L: 20, og: 1.05, style: 'lager' })
    expect(lager.rate_M_per_mL_per_P).toBe(1.5)
    expect(lager.cells_B).toBeCloseTo(ale.cells_B * 2, 0)
  })

  it('pressure fermentation also uses the 1.5 rate', () => {
    const r = calcPitchRate({ batchSize_L: 20, og: 1.05, style: 'pressure' })
    expect(r.rate_M_per_mL_per_P).toBe(1.5)
  })

  it('high-gravity pitches harder than a standard ale', () => {
    const ale = calcPitchRate({ batchSize_L: 20, og: 1.09, style: 'ale' })
    const hg = calcPitchRate({ batchSize_L: 20, og: 1.09, style: 'high-gravity' })
    expect(hg.rate_M_per_mL_per_P).toBeGreaterThan(ale.rate_M_per_mL_per_P)
    expect(hg.cells_B).toBeGreaterThan(ale.cells_B)
  })

  it('reports plato from sgToPlato', () => {
    const r = calcPitchRate({ batchSize_L: 20, og: 1.05, style: 'ale' })
    expect(r.plato).toBeCloseTo(12.39, 1)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/pitch/pitch-rate.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
