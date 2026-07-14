import { describe, expect, it } from 'vitest'
import { calcIBURager } from '@/lib/brewing/calc/ibu/rager'
import { calcIBUTinseth } from '@/lib/brewing/calc/ibu/tinseth'
import { calcSRM } from '@/lib/brewing/calc/srm'
import { calcSRMMorey } from '@/lib/brewing/calc/srm/morey'
import { platoToSG, sgToPlato } from '@/lib/brewing/convert/gravity'
import { calcStrikeTemp } from '@/lib/brewing/mash/strike'
import type { FermentableUse, HopUse } from '@/lib/brewing/types/recipe-parts'

/**
 * Independent golden-master fixtures — published worked examples (NOT this app's
 * own outputs). Sources: Tinseth (realbeer.com), Rager (Zymurgy 1990),
 * Morey SRM, Palmer "How to Brew" 4e ch.15, ASBC Plato cubic / Lincoln inverse.
 * See docs/research/2026-06-19-brewing-formula-references.md.
 */

const OZ_G = 28.349523125
const LB_KG = 0.45359237
const GAL_L = 3.785411784
const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol)

// Whole/leaf (form factor 1.0) so these validate the BASE published utilization
// math against the literature — the pellet ×1.10 form bonus (hop-form.ts) is
// exercised separately in calc-hop-form.test.ts.
const hop = (amount_g: number, aa: number, time_min: number): HopUse => ({
  ingredientId: '00000000-0000-4000-8000-000000000001',
  snapshot: { name: 'test', alphaAcid_pct: aa, form: 'leaf' },
  amount_g,
  time_min,
  use: 'boil',
})

const ferm = (lb: number, color_L: number): FermentableUse => ({
  ingredientId: '00000000-0000-4000-8000-000000000002',
  snapshot: { name: 'test', type: 'base', ppg: 36, color_L },
  amount_kg: lb * LB_KG,
  usage: 'mash',
  afterBoil: false,
})

describe('golden masters — IBU (Tinseth)', () => {
  it('T-1: 1 oz @10% AA, 60 min, BG 1.050, 5 gal → 34.56 IBU', () => {
    const ibu = calcIBUTinseth([hop(1 * OZ_G, 10, 60)], 1.05, 5 * GAL_L, 1)
    within(ibu, 34.56, 0.3)
  })
  it('T-2: 1 oz @12% AA, 15 min, BG 1.065, 5.5 gal → 16.34 IBU', () => {
    const ibu = calcIBUTinseth([hop(1 * OZ_G, 12, 15)], 1.065, 5.5 * GAL_L, 1)
    within(ibu, 16.34, 0.3)
  })
})

describe('golden masters — IBU (Rager)', () => {
  it('R-1: 1.5 oz @6.4% AA, 45 min, BG 1.050, 5 gal → 38.53 IBU', () => {
    const ibu = calcIBURager([hop(1.5 * OZ_G, 6.4, 45)], 1.05, 5 * GAL_L, 1)
    // ±0.5 absorbs the Rager-7462 vs internal-7490 constant choice.
    within(ibu, 38.53, 0.5)
  })
})

describe('golden masters — SRM (Morey)', () => {
  it('C-1 curve: MCU 11.636 → 8.03 SRM', () => {
    within(calcSRMMorey(11.636), 8.03, 0.05)
  })
  it('C-1 end-to-end: 9.5 lb@2°L + 0.75 lb@60°L, 5.5 gal → 8.03 SRM', () => {
    const srm = calcSRM([ferm(9.5, 2), ferm(0.75, 60)], 5.5 * GAL_L, 'morey')
    within(srm, 8.03, 0.05)
  })
})

describe('golden masters — strike water (Palmer, metric)', () => {
  it('S-2: grain 20°C, mash 66.7°C, R 2.918 L/kg → 73.3°C', () => {
    within(calcStrikeTemp(66.7, 20, 2.918), 73.3, 0.5)
  })
})

describe('golden masters — Plato ↔ SG', () => {
  it('P-1: SG 1.050 → 12.378 °P (ASBC cubic)', () => {
    within(sgToPlato(1.05), 12.378, 0.05)
  })
  it('P-2: 12.0 °P → 1.04837 SG (Lincoln inverse)', () => {
    within(platoToSG(12.0), 1.04837, 0.0002)
  })
})
