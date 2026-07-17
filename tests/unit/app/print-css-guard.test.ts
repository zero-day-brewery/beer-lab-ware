import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Print-stylesheet guard: the brew-sheet print rules must live INSIDE the
 * single @media print block so they can never leak into screen rendering,
 * and the app chrome that would pollute a printed page must be hidden there.
 */
describe('print CSS guard', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/app/globals.css'), 'utf8')
  const printIdx = css.indexOf('@media print {')

  it('has exactly one @media print block', () => {
    expect(printIdx).toBeGreaterThan(0)
    expect(css.indexOf('@media print {', printIdx + 1)).toBe(-1)
  })

  const printBlock = css.slice(printIdx)

  it('hides floating/app chrome when printing (incl. the AI companion FAB)', () => {
    for (const cls of ['.app-header', '.sidebar', '.companion-fab', '.report-actions']) {
      expect(printBlock, `expected ${cls} to be handled in the print block`).toContain(cls)
    }
  })

  it('hides the batch sheet input affordances when printing', () => {
    for (const cls of ['.ferment-form', '.ferment-del', '.logsheet .btn-primary']) {
      expect(printBlock).toContain(cls)
    }
  })

  it('defines .print-blank ONLY inside the print block (no screen leak)', () => {
    const firstIdx = css.indexOf('.print-blank')
    expect(firstIdx).toBeGreaterThan(printIdx)
  })

  it('flattens the theme tokens to ink-on-paper for print', () => {
    // The token override must live inside the print block AND after the last
    // per-theme token block so it wins the cascade at equal specificity.
    const tokenIdx = css.indexOf('--background: #fff')
    expect(tokenIdx).toBeGreaterThan(printIdx)
    expect(css.lastIndexOf('html[data-theme="')).toBeLessThan(tokenIdx)
    expect(printBlock).toContain('--foreground: #000')
  })
})
