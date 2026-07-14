import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('logbook CSS placement guard', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/app/globals.css'), 'utf8')

  it('defines at least one batchlist-* class', () => {
    expect(css).toMatch(/\.batchlist-/)
  })

  it('defines at least one logsheet-* class', () => {
    expect(css).toMatch(/\.logsheet/)
  })

  it('defines at least one trend-* class', () => {
    expect(css).toMatch(/\.trend-/)
  })

  it('places every logbook class BEFORE the @media print block (Tailwind v4 drop guard)', () => {
    // Use '@media print {' (with brace) to match ONLY the real block — not comment strings
    const printIdx = css.indexOf('@media print {')
    expect(printIdx).toBeGreaterThan(0)

    const classesToCheck: readonly string[] = [
      '.batchlist-row',
      '.batchlist-filters',
      '.batchlist-chip',
      '.batchlist-action',
      '.logsheet',
      '.logsheet-section',
      '.trend-card',
      '.trend-spark',
    ]

    for (const cls of classesToCheck) {
      const idx = css.indexOf(cls)
      expect(idx, `Expected "${cls}" to be defined in globals.css`).toBeGreaterThan(0)
      expect(
        idx,
        `Expected "${cls}" to appear BEFORE @media print (line ~${printIdx})`,
      ).toBeLessThan(printIdx)
    }
  })
})
