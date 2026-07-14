import { describe, expect, it } from 'vitest'

import { currentViability, viableCells } from '@/lib/brewing/inventory/yeast-viability'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const base: Omit<YeastLot, 'form' | 'productionDate' | 'initialCells_B'> = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Test Yeast',
  strain: 'California Ale',
  generation: 0,
  quantity: 1,
  unit: 'vial',
  notes_md: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 1,
}

function lot(form: YeastLot['form'], daysAgo: number, initialCells_B = 100): YeastLot {
  const now = new Date('2026-06-01T00:00:00.000Z')
  const prod = new Date(now.getTime() - daysAgo * 86_400_000)
  return { ...base, form, productionDate: prod.toISOString(), initialCells_B }
}
const NOW = new Date('2026-06-01T00:00:00.000Z')

describe('currentViability', () => {
  it('liquid: 97% at production, −0.7%/day', () => {
    expect(currentViability(lot('liquid', 0), NOW)).toBeCloseTo(97, 5)
    expect(currentViability(lot('liquid', 10), NOW)).toBeCloseTo(90, 5) // 97 − 7
  })

  it('dry: near-flat decline (far more stable than liquid)', () => {
    const v30 = currentViability(lot('dry', 30), NOW)
    expect(v30).toBeGreaterThan(95) // ~97.4 — barely moved in a month
    expect(v30).toBeLessThan(98)
  })

  it('slurry: declines faster than liquid', () => {
    const vs = currentViability(lot('slurry', 10), NOW)
    const vl = currentViability(lot('liquid', 10), NOW)
    expect(vs).toBeLessThan(vl)
  })

  it('clamps to 0–100', () => {
    expect(currentViability(lot('liquid', 500), NOW)).toBe(0)
    expect(currentViability(lot('liquid', -5), NOW)).toBeLessThanOrEqual(100)
  })
})

describe('viableCells', () => {
  it('scales initial cells by current viability', () => {
    // liquid 10d → 90% of 100B = 90B
    expect(viableCells(lot('liquid', 10, 100), NOW)).toBeCloseTo(90, 5)
  })

  it('is 0 when fully decayed', () => {
    expect(viableCells(lot('liquid', 500, 100), NOW)).toBe(0)
  })
})
