import { describe, expect, it } from 'vitest'
import { type BoardOp, projectEffects } from '@/lib/brewing/process/board-projection'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { BoardEffect } from '@/lib/brewing/process/types'

// Minimal session — only the fields projectEffects reads.
function sessionFixture(over: Partial<BrewSession> = {}): BrewSession {
  return {
    recipeName: 'West Coast IPA',
    water: { additionsSummary: '6 g gypsum · 4 g CaCl₂', skipped: false },
    ...over,
  } as unknown as BrewSession
}

describe('projectEffects', () => {
  it('maps startSession and enriches recipeName + water from the session', () => {
    const ops = projectEffects([{ t: 'startSession' }], sessionFixture())
    expect(ops).toEqual<BoardOp[]>([
      {
        op: 'startSession',
        recipeName: 'West Coast IPA',
        additionsSummary: '6 g gypsum · 4 g CaCl₂',
        skipped: false,
      },
    ])
  })

  it('maps a skipped water plan into the startSession op', () => {
    const s = sessionFixture({ water: { skipped: true } } as Partial<BrewSession>)
    const ops = projectEffects([{ t: 'startSession' }], s)
    expect(ops[0]).toEqual({ op: 'startSession', recipeName: 'West Coast IPA', skipped: true })
  })

  it('maps station effects 1:1, preserving station + target state', () => {
    const effects: BoardEffect[] = [
      { t: 'station', station: 'brew', to: 'active' },
      { t: 'station', station: 'wortChiller', to: 'active' },
      { t: 'station', station: 'cooler', to: 'idle' },
    ]
    expect(projectEffects(effects, sessionFixture())).toEqual<BoardOp[]>([
      { op: 'station', station: 'brew', to: 'active' },
      { op: 'station', station: 'wortChiller', to: 'active' },
      { op: 'station', station: 'cooler', to: 'idle' },
    ])
  })

  it('maps fermenter status + stageFocus + endSession + note', () => {
    const effects: BoardEffect[] = [
      { t: 'fermenter', to: 'fermenting' },
      { t: 'stageFocus', stage: 'fermentation' },
      { t: 'note', text: 'pitched @ 18°C' },
      { t: 'endSession' },
    ]
    expect(projectEffects(effects, sessionFixture())).toEqual<BoardOp[]>([
      { op: 'fermenter', to: 'fermenting' },
      { op: 'focusStage', stage: 'fermentation' },
      { op: 'note', text: 'pitched @ 18°C' },
      { op: 'endSession' },
    ])
  })

  it('preserves order across mixed effects and returns a new array', () => {
    const effects: BoardEffect[] = [
      { t: 'startSession' },
      { t: 'station', station: 'brew', to: 'active' },
      { t: 'stageFocus', stage: 'hotside' },
    ]
    const ops = projectEffects(effects, sessionFixture())
    expect(ops.map((o) => o.op)).toEqual(['startSession', 'station', 'focusStage'])
  })

  it('returns an empty list for no effects (idempotent no-op)', () => {
    expect(projectEffects([], sessionFixture())).toEqual([])
  })
})
