import { describe, expect, it } from 'vitest'
import { BJCP_2021_STYLES, findStyle } from '@/lib/brewing/styles/bjcp-2021'
import { BJCPStyleSchema } from '@/lib/brewing/types/style'

describe('BJCP 2021 styles seed', () => {
  it('contains at least 20 styles', () => {
    expect(BJCP_2021_STYLES.length).toBeGreaterThanOrEqual(20)
  })

  it('every style parses against BJCPStyleSchema', () => {
    for (const s of BJCP_2021_STYLES) {
      expect(() => BJCPStyleSchema.parse(s)).not.toThrow()
    }
  })

  it('includes American IPA (21A)', () => {
    expect(BJCP_2021_STYLES.find((s) => s.id === '21A')).toBeDefined()
  })

  it('findStyle returns the style by id', () => {
    const s = findStyle('21A')
    expect(s?.name).toBe('American IPA')
  })

  it('findStyle returns undefined for unknown id', () => {
    expect(findStyle('999X')).toBeUndefined()
  })
})
