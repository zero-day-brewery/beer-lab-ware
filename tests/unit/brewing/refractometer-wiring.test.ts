import { describe, expect, it } from 'vitest'
import { brixToSG, sgToBrix } from '@/lib/brewing/convert/gravity'
import { correctedFG } from '@/lib/brewing/convert/refractometer'

describe('refractometer FG correction wiring', () => {
  it('corrects a current Brix reading against OG into a plausible FG', () => {
    const og = 1.06
    const currentBrix = 6.5
    const fg = correctedFG(og, brixToSG(currentBrix))
    expect(fg).toBeLessThan(og)
    expect(fg).toBeGreaterThan(0.99)
    expect(fg).toBeLessThan(1.03)
  })

  it('returns OG unchanged when there is no Brix drop (no fermentation yet)', () => {
    const og = 1.05
    const noDropReading = brixToSG(sgToBrix(og)) // current Brix equals OG in Brix
    expect(correctedFG(og, noDropReading)).toBeCloseTo(og, 3)
  })
})
