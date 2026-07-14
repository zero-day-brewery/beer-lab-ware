import { describe, expect, it } from 'vitest'
import { type BJCPStyle, BJCPStyleSchema } from '@/lib/brewing/types/style'

describe('BJCPStyleSchema', () => {
  const validStyle: BJCPStyle = {
    id: '21A',
    categoryNumber: '21',
    categoryName: 'IPA',
    name: 'American IPA',
    vitalStats: {
      OG: [1.056, 1.07],
      FG: [1.008, 1.014],
      IBU: [40, 70],
      SRM: [6, 14],
      ABV: [5.5, 7.5],
    },
    description_md: 'An American interpretation of the historical English IPA style.',
  }

  it('accepts a valid style', () => {
    expect(() => BJCPStyleSchema.parse(validStyle)).not.toThrow()
  })

  it('requires vitalStats to be tuples of two numbers (min, max)', () => {
    expect(() =>
      BJCPStyleSchema.parse({
        ...validStyle,
        vitalStats: { ...validStyle.vitalStats, OG: [1.056] },
      }),
    ).toThrow()
  })

  it('rejects when min > max in any range', () => {
    expect(() =>
      BJCPStyleSchema.parse({
        ...validStyle,
        vitalStats: { ...validStyle.vitalStats, OG: [1.07, 1.056] },
      }),
    ).toThrow()
  })
})
