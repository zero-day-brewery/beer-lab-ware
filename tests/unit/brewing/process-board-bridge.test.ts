import { beforeEach, describe, expect, it } from 'vitest'
import type { BoardOp } from '@/lib/brewing/process/board-projection'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { BoardEffect } from '@/lib/brewing/process/types'
import { applyEffects, applyOps } from '@/stores/board-bridge'
import { type CoolerKind, useSystemStore } from '@/stores/system-store'

const st = () => useSystemStore.getState()
// Station ops target equipment groups in the array model.
const brewOn = () => st().brewSystems.some((b) => b.status === 'active')
const coolerOn = (kind: CoolerKind) =>
  st().coolers.some((c) => c.kind === kind && c.status === 'active')

beforeEach(() => {
  st().stopBrew()
  st().reset()
})

describe('applyOps', () => {
  it('startSession → startBrew (board active + currentBrew populated)', () => {
    applyOps([
      { op: 'startSession', recipeName: 'Pils', additionsSummary: '4 g CaCl₂', skipped: false },
    ])
    expect(brewOn()).toBe(true)
    expect(st().currentBrew?.recipeName).toBe('Pils')
    expect(st().currentBrew?.additionsSummary).toBe('4 g CaCl₂')
  })

  it('station brew→active is a no-op when already active (idempotent)', () => {
    applyOps([{ op: 'startSession', recipeName: 'Pils' }]) // brew now active
    applyOps([{ op: 'station', station: 'brew', to: 'active' }])
    expect(brewOn()).toBe(true) // not toggled back to idle
  })

  it('station brew→idle drives every active brew system off', () => {
    applyOps([{ op: 'startSession' }])
    applyOps([{ op: 'station', station: 'brew', to: 'idle' }])
    expect(brewOn()).toBe(false)
  })

  it('station wortChiller/cooler drive the counterflow + glycol coolers to target', () => {
    // Default coolers are glycol-only now; add a standalone counterflow so the
    // wortChiller station has a counterflow instance to drive.
    st().addCooler('counterflow')
    applyOps([
      { op: 'station', station: 'wortChiller', to: 'active' },
      { op: 'station', station: 'cooler', to: 'active' },
    ])
    expect(coolerOn('counterflow')).toBe(true)
    expect(coolerOn('glycol')).toBe(true)
  })

  it('fermenter op patches the targeted fermenter status', () => {
    applyOps([{ op: 'fermenter', to: 'fermenting' }], 'f2')
    expect(st().fermenters.find((f) => f.id === 'f2')?.status).toBe('fermenting')
    expect(st().fermenters.find((f) => f.id === 'f1')?.status).toBe('empty')
  })

  it('fermenting op with a batchId stamps Fermenter.batchId (the real link)', () => {
    applyOps([{ op: 'fermenter', to: 'fermenting' }], 'f1', 'batch-123')
    const f = st().fermenters.find((f) => f.id === 'f1')
    expect(f?.status).toBe('fermenting')
    expect(f?.batchId).toBe('batch-123')
  })

  it('fermenting op without a batchId stamps status only (no undefined clobber)', () => {
    applyOps([{ op: 'fermenter', to: 'fermenting' }], 'f1')
    const f = st().fermenters.find((f) => f.id === 'f1')
    expect(f?.status).toBe('fermenting')
    expect(f?.batchId).toBeUndefined()
  })

  it('a batchId on a non-fermenting transition is NOT stamped (fermenting-edge only)', () => {
    applyOps([{ op: 'fermenter', to: 'cold-crash' }], 'f1', 'batch-xyz')
    const f = st().fermenters.find((f) => f.id === 'f1')
    expect(f?.status).toBe('cold-crash')
    expect(f?.batchId).toBeUndefined()
  })

  it('emptying a fermenter (cycle-wrap to empty) clears a previously-stamped batchId', () => {
    // Stamp the link first, then cycle the vessel all the way back to 'empty'.
    applyOps([{ op: 'fermenter', to: 'fermenting' }], 'f1', 'batch-clearme')
    expect(st().fermenters.find((f) => f.id === 'f1')?.batchId).toBe('batch-clearme')
    // FERM_FLOW: fermenting → cold-crash → conditioning → packaged → empty (4 cycles)
    for (let i = 0; i < 4; i++) st().cycleFermenter('f1')
    const f = st().fermenters.find((f) => f.id === 'f1')
    expect(f?.status).toBe('empty')
    expect(f?.batchId).toBeUndefined()
  })

  it('endSession → stopBrew', () => {
    applyOps([{ op: 'startSession' }])
    applyOps([{ op: 'endSession' }])
    expect(brewOn()).toBe(false)
    expect(st().currentBrew).toBeNull()
  })

  it('focusStage and note are board no-ops', () => {
    const before = brewOn()
    applyOps([
      { op: 'focusStage', stage: 'hotside' },
      { op: 'note', text: 'x' },
    ])
    expect(brewOn()).toBe(before)
    expect(st().currentBrew).toBeNull()
  })

  it('re-applying an already-satisfied op-list is idempotent', () => {
    const ops: BoardOp[] = [
      { op: 'startSession', recipeName: 'Pils' },
      { op: 'station', station: 'wortChiller', to: 'active' },
      { op: 'fermenter', to: 'fermenting' },
    ]
    applyOps(ops, 'f1')
    const snap1 = JSON.stringify({
      brew: brewOn(),
      wort: coolerOn('counterflow'),
      ferm: st().fermenters.find((f) => f.id === 'f1')?.status,
    })
    applyOps(ops, 'f1') // resume replay
    const snap2 = JSON.stringify({
      brew: brewOn(),
      wort: coolerOn('counterflow'),
      ferm: st().fermenters.find((f) => f.id === 'f1')?.status,
    })
    expect(snap2).toBe(snap1)
  })
})

describe('applyEffects', () => {
  it('projects then applies in one call', () => {
    const session = { recipeName: 'ESB', water: { skipped: true } } as unknown as BrewSession
    const effects: BoardEffect[] = [
      { t: 'startSession' },
      { t: 'station', station: 'brew', to: 'active' },
    ]
    applyEffects(effects, session)
    expect(brewOn()).toBe(true)
    expect(st().currentBrew?.recipeName).toBe('ESB')
    expect(st().currentBrew?.skipped).toBe(true)
  })

  it('threads batchId through a fermenting effect and stamps it on the target vessel', () => {
    const session = { recipeName: 'Saison' } as unknown as BrewSession
    const effects: BoardEffect[] = [{ t: 'fermenter', to: 'fermenting' }]
    applyEffects(effects, session, 'f1', 'batch-eff-1')
    const f = st().fermenters.find((f) => f.id === 'f1')
    expect(f?.status).toBe('fermenting')
    expect(f?.batchId).toBe('batch-eff-1')
  })
})
