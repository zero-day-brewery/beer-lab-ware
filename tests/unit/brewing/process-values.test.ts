import { describe, expect, it } from 'vitest'
import type { ValueToken } from '@/lib/brewing/process/types'
import { injectValues, type ResolveCtx } from '@/lib/brewing/process/values'
import type { CalculationResult } from '@/lib/brewing/types/results'

const calc: CalculationResult = {
  volumes: {
    mashWater_L: 13,
    spargeWater_L: 20.1,
    preBoilVolume_L: 27.6,
    postBoilVolume_L: 26,
    intoFermenter_L: 23,
  },
  OG: 1.048,
  FG: 1.012,
  ABV: 4.7,
  IBU: 35,
  SRM: 6,
  strikeTemp_C: 73.3,
  formulasUsed: { abv: 'simple', ibu: 'tinseth', srm: 'morey' },
  computedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 1,
} as unknown as CalculationResult

const ctx: ResolveCtx = { calc }

const tok = (over: Partial<ValueToken> & Pick<ValueToken, 'key'>): ValueToken => ({
  label: over.key,
  source: 'calc',
  ...over,
})

describe('injectValues', () => {
  it('targetOG resolves from calc.OG with precision 3', () => {
    const r = injectValues(tok({ key: 'targetOG', precision: 3 }), ctx)
    expect(r.value).toBeCloseTo(1.048, 3)
    expect(r.display).toBe('1.048')
  })

  it('targetIBU resolves from calc.IBU with default precision 0', () => {
    const r = injectValues(tok({ key: 'targetIBU' }), ctx)
    expect(r.value).toBe(35)
    expect(r.display).toBe('35')
  })

  it('volume keys resolve from calc.volumes with a unit appended', () => {
    const r = injectValues(tok({ key: 'mashWater_L', unit: 'L', precision: 1 }), ctx)
    expect(r.value).toBeCloseTo(13, 1)
    expect(r.display).toBe('13.0 L')
  })

  it('strikeTemp_C resolves from calc.strikeTemp_C', () => {
    const r = injectValues(tok({ key: 'strikeTemp_C', unit: '°C', precision: 1 }), ctx)
    expect(r.display).toBe('73.3 °C')
  })

  it('mashStepTemp_C resolves from recipe.mashSteps[index]', () => {
    const recipe = {
      mashSteps: [
        { name: 'Sacch', type: 'temperature', temperature_C: 66, time_min: 60 },
        { name: 'Mash Out', type: 'temperature', temperature_C: 76, time_min: 10 },
      ],
    }
    const r = injectValues(
      tok({ key: 'mashStepTemp_C', source: 'recipe', index: 1, unit: '°C', precision: 0 }),
      {
        calc,
        recipe: recipe as never,
      },
    )
    expect(r.display).toBe('76 °C')
  })

  it('grainAbsorption_LperKg resolves from equipment', () => {
    const r = injectValues(
      tok({ key: 'grainAbsorption_LperKg', source: 'equipment', unit: 'L/kg', precision: 1 }),
      {
        calc,
        equipment: { grainAbsorption_LperKg: 1.0, coolingShrinkage_pct: 4 } as never,
      },
    )
    expect(r.display).toBe('1.0 L/kg')
  })

  it('estMashPh resolves from the water plan context', () => {
    const r = injectValues(tok({ key: 'estMashPh', source: 'water', precision: 2 }), {
      calc,
      water: { estMashPh: 5.38 },
    })
    expect(r.display).toBe('5.38')
  })

  it('graceful fallback: missing calc → null value + em-dash', () => {
    const r = injectValues(tok({ key: 'targetOG', precision: 3 }), {})
    expect(r.value).toBeNull()
    expect(r.display).toBe('—')
  })

  it('graceful fallback: deferred keys (later phases) resolve to em-dash now', () => {
    for (const key of [
      'attenuationPct',
      'correctedFG',
      'finalABV',
      'brewhouseEfficiency_pct',
      'pitchCells_B',
      'co2SetPsi',
    ] as const) {
      const r = injectValues(tok({ key, source: 'derived' }), ctx)
      expect(r.display).toBe('—')
      expect(r.value).toBeNull()
    }
  })

  it('out-of-range mash step index → em-dash, no throw', () => {
    const r = injectValues(tok({ key: 'mashStepTemp_C', source: 'recipe', index: 9 }), {
      calc,
      recipe: { mashSteps: [] } as never,
    })
    expect(r.display).toBe('—')
  })

  it('I2 — index "last" resolves the final mashSteps entry (mash-out)', () => {
    const recipe = {
      mashSteps: [
        { name: 'Sacch Rest', type: 'temperature', temperature_C: 67, time_min: 60 },
        { name: 'Mash Out', type: 'temperature', temperature_C: 76, time_min: 10 },
      ],
    }
    const tempResult = injectValues(
      tok({ key: 'mashStepTemp_C', source: 'recipe', index: 'last', unit: '°C', precision: 0 }),
      { calc, recipe: recipe as never },
    )
    expect(tempResult.display).toBe('76 °C')

    const timeResult = injectValues(
      tok({ key: 'mashStepTime_min', source: 'recipe', index: 'last', unit: 'min', precision: 0 }),
      { calc, recipe: recipe as never },
    )
    expect(timeResult.display).toBe('10 min')
  })

  it('I2 — index "last" on a single-step recipe resolves index 0', () => {
    const recipe = {
      mashSteps: [{ name: 'Sacch', type: 'temperature', temperature_C: 68, time_min: 60 }],
    }
    const r = injectValues(
      tok({ key: 'mashStepTemp_C', source: 'recipe', index: 'last', unit: '°C', precision: 0 }),
      { calc, recipe: recipe as never },
    )
    expect(r.display).toBe('68 °C')
  })

  it('I2 — index "last" with empty mashSteps → em-dash, no throw', () => {
    const r = injectValues(tok({ key: 'mashStepTemp_C', source: 'recipe', index: 'last' }), {
      calc,
      recipe: { mashSteps: [] } as never,
    })
    expect(r.display).toBe('—')
  })
})
