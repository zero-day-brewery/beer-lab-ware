import { describe, expect, it } from 'vitest'
import { type CalculationResult, CalculationResultSchema } from '@/lib/brewing/types/results'

describe('CalculationResultSchema', () => {
  const validResult: CalculationResult = {
    volumes: {
      mashWater_L: 14.2,
      spargeWater_L: 11.8,
      preBoilVolume_L: 22.3,
      postBoilVolume_L: 19.3,
      intoFermenter_L: 19.0,
    },
    OG: 1.052,
    FG: 1.012,
    ABV: 5.25,
    IBU: 38,
    SRM: 6.5,
    strikeTemp_C: 72.4,
    formulasUsed: {
      ibu: 'tinseth',
      srm: 'morey',
      abv: 'simple',
    },
    computedAt: '2026-05-12T13:00:00.000Z',
    schemaVersion: 1,
  }

  it('accepts a valid result', () => {
    expect(() => CalculationResultSchema.parse(validResult)).not.toThrow()
  })

  it('rejects negative IBU', () => {
    expect(() => CalculationResultSchema.parse({ ...validResult, IBU: -1 })).toThrow()
  })

  it('rejects unknown ibu formula', () => {
    expect(() =>
      CalculationResultSchema.parse({
        ...validResult,
        formulasUsed: { ...validResult.formulasUsed, ibu: 'voodoo' as 'tinseth' },
      }),
    ).toThrow()
  })

  it('requires all 5 volume fields', () => {
    expect(() =>
      CalculationResultSchema.parse({
        ...validResult,
        volumes: { mashWater_L: 14, spargeWater_L: 12, preBoilVolume_L: 22, postBoilVolume_L: 19 },
      }),
    ).toThrow()
  })
})
