/**
 * Golden-value pins for the SAFETY-CRITICAL pressure calculators.
 *
 * Every expected number below is a PUBLISHED reference value (a chart cell, a
 * table row, or a source's worked example) — never an echo of the engine's own
 * output. If one of these fails, the pressure math has drifted from its
 * published source: do NOT loosen the tolerance; find out what changed.
 *
 * Model context (read before editing): co2-volumes.ts is the single CO2 curve
 * for the whole app — the De Clerck / Henry's-law fit used by the Brewer's
 * Friend force-carbonation chart and keg carbonation calculator:
 *   vols = (P + 14.695) · (0.01821 + 0.09011·e^(−(Tf−32)/43.11)) − 0.003342
 * so values from that chart family are the primary source, and independently
 * published charts (kegerators.com) are used as cross-checks. Where two
 * published fit families disagree (residual CO2), the tolerance states the
 * documented divergence instead of being quietly widened.
 */

import { describe, expect, it } from 'vitest'
import { calcForceCarb } from '@/lib/brewing/carbonation/force-carb'
import { balancedLineLength_ft } from '@/lib/brewing/carbonation/line-balance'
import { residualCo2Vol } from '@/lib/brewing/carbonation/residual-co2'
import { calcSpunding } from '@/lib/brewing/carbonation/spunding'
import { fToC } from '@/lib/brewing/convert/temp'

/** |actual − published| must stay within the stated tolerance. */
function expectWithin(actual: number, published: number, tolerance: number) {
  expect(Math.abs(actual - published)).toBeLessThanOrEqual(tolerance)
}

describe('calcForceCarb — golden values from published forced-carbonation charts', () => {
  // Charts print psi columns in whole-psi steps, so ±0.5 psi reflects chart
  // granularity (per the work-package spec; the engine's docs claim no tighter).
  const PSI_TOL = 0.5

  it('2.39 vols @ 40°F → 11 psi (Brewer’s Friend force-carbonation chart cell)', () => {
    // Source: brewersfriend.com/force-carbonation-chart — the 40°F row reads
    // 2.39 volumes under the 11 psi column.
    const { setPsi } = calcForceCarb({ targetVol: 2.39, servingTemp_C: fToC(40) })
    expectWithin(setPsi, 11, PSI_TOL)
  })

  it('2.4 vols @ 38°F → 10 psi (Brewer’s Friend worked example)', () => {
    // Source: brewersfriend.com/force-carbonation-chart — "At 38°F and 10 psi,
    // you will develop about 2.4 volumes of CO2".
    const { setPsi } = calcForceCarb({ targetVol: 2.4, servingTemp_C: fToC(38) })
    expectWithin(setPsi, 10, PSI_TOL)
  })

  it('2.0 vols @ 34°F → ≈4.3 psi (kegerators.com carbonation table, interpolated)', () => {
    // Source: kegerators.com/carbonation-table — 34°F row: 4 psi → 1.97 vols,
    // 5 psi → 2.06 vols, so 2.0 volumes sits at ≈4.3 psi.
    const { setPsi } = calcForceCarb({ targetVol: 2.0, servingTemp_C: fToC(34) })
    expectWithin(setPsi, 4.3, PSI_TOL)
  })

  it('2.6 vols @ 40°F → ≈13.3 psi (Brewer’s Friend chart, interpolated)', () => {
    // Source: brewersfriend.com/force-carbonation-chart — 40°F row: 13 psi →
    // 2.57 vols, 14 psi → 2.67 vols, so 2.6 volumes sits at ≈13.3 psi.
    const { setPsi } = calcForceCarb({ targetVol: 2.6, servingTemp_C: fToC(40) })
    expectWithin(setPsi, 13.3, PSI_TOL)
  })

  it('2.2 vols @ 50°F → ≈13.7 psi (Brewer’s Friend chart, interpolated)', () => {
    // Source: brewersfriend.com/force-carbonation-chart — 50°F row: 13 psi →
    // 2.14 vols, 14 psi → 2.22 vols, so 2.2 volumes sits at ≈13.7 psi.
    const { setPsi } = calcForceCarb({ targetVol: 2.2, servingTemp_C: fToC(50) })
    expectWithin(setPsi, 13.7, PSI_TOL)
  })
})

describe('calcSpunding — golden values from published spunding references', () => {
  // Spunding charts publish in ~0.1 bar / whole-psi steps and sources round to
  // "approximately"; ±1.5 psi (≈0.1 bar) reflects that granularity.
  const PSI_TOL = 1.5

  it('2.5 vols @ 68°F ale fermentation → ≈30 psi', () => {
    // Source: Braukaiser carbonation tables / spunding practice (e.g.
    // homebrewtalk spunding references): holding ~2.5 volumes at 68°F ale
    // temperature requires fermenting under approximately 30 psi.
    const r = calcSpunding({ targetVol: 2.5, fermTemp_C: fToC(68), mawp_psi: 50 })
    expectWithin(r.setpoint_psi, 30, PSI_TOL)
    expect(r.cappedToMawp).toBe(false)
    expect(r.finishColdInKeg).toBe(false)
  })

  it('2.5 vols @ 12°C → ≈20 psi, inside the published 18–23 psi band', () => {
    // Source: BYO spunding references (documented in spunding.ts): at 12°C,
    // 2.4–2.7 volumes needs ~18–23 psi; the 2.5-vol midpoint sits near 20 psi.
    const r = calcSpunding({ targetVol: 2.5, fermTemp_C: 12, mawp_psi: 50 })
    expectWithin(r.setpoint_psi, 20, PSI_TOL)
    expect(r.setpoint_psi).toBeGreaterThanOrEqual(18)
    expect(r.setpoint_psi).toBeLessThanOrEqual(23)
  })

  it('MAWP cap: 2.6 vols @ 20°C (needs ≈31 psi) on a 15 psi-rated vessel → exactly 15 psi', () => {
    // Source: same chart family — 2.6 volumes at 68°F needs ≈31 psi, well over
    // the ~15 psi MAWP typical of budget pressure fermenters. The setpoint must
    // clamp EXACTLY to MAWP (never above the vessel rating) and flag the
    // finish-cold-in-keg path.
    const r = calcSpunding({ targetVol: 2.6, fermTemp_C: 20, mawp_psi: 15 })
    expect(r.setpoint_psi).toBe(15)
    expect(r.cappedToMawp).toBe(true)
    expect(r.finishColdInKeg).toBe(true)
  })
})

describe('balancedLineLength_ft — golden values from published line-balancing guides', () => {
  it('11 psi ÷ 2 psi/ft → 5.5 ft (the classic textbook case)', () => {
    // Source: Brewers Association draught guidance / BeerSmith line balancing:
    // line length = serving pressure ÷ line resistance; 3/16" vinyl at the
    // textbook 2 psi/ft with an 11 psi keg balances at ≈5.5 ft.
    expect(balancedLineLength_ft({ servingPsi: 11 })).toBeCloseTo(5.5, 10)
  })

  it('12 psi ÷ 1.5 psi/ft → 8 ft (real-world 3/16" resistance)', () => {
    // Source: BeerSmith line-balancing notes (documented in line-balance.ts):
    // real 3/16" ID line runs ≈1–1.5 psi/ft, giving 12 ÷ 1.5 = 8 ft.
    expect(balancedLineLength_ft({ servingPsi: 12, resistance_psiPerFt: 1.5 })).toBeCloseTo(8, 10)
  })
})

describe('residualCo2Vol — golden values from the standard residual-CO2 table', () => {
  // The engine evaluates Henry's law (De Clerck fit) at the crash temperature;
  // the widely published "CO2 volumes at end of fermentation" table (ASBC-style
  // quadratic fit, reproduced in Palmer's How to Brew and AHA references) is a
  // different published fit family that agrees within ~0.07 volumes over the
  // 50–68°F range — ±0.1 vols states that documented divergence, not slack.
  const VOL_TOL = 0.1

  it('0 psi head @ 68°F → 0.85 volumes residual', () => {
    // Source: standard residual-CO2 table — beer at 68°F under atmospheric
    // pressure retains ≈0.85 volumes of CO2 after fermentation.
    expectWithin(residualCo2Vol({ spundSetpoint_psi: 0, crashTemp_C: fToC(68) }), 0.85, VOL_TOL)
  })

  it('0 psi head @ 50°F → 1.2 volumes residual', () => {
    // Source: standard residual-CO2 table — ≈1.2 volumes at 50°F.
    expectWithin(residualCo2Vol({ spundSetpoint_psi: 0, crashTemp_C: fToC(50) }), 1.2, VOL_TOL)
  })
})
