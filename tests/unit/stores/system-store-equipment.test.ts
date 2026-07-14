import { beforeEach, describe, expect, it } from 'vitest'
import { migrateSystemFlow, useSystemStore } from '@/stores/system-store'

const st = () => useSystemStore.getState()

beforeEach(() => {
  st().stopBrew()
  st().reset()
})

describe('system-store — fermenters add/remove', () => {
  it('addFermenter grows the array; removeFermenter shrinks it', () => {
    const n = st().fermenters.length
    st().addFermenter()
    expect(st().fermenters).toHaveLength(n + 1)
    const added = st().fermenters[st().fermenters.length - 1]
    expect(added.status).toBe('empty')
    expect(added.id).toBeTruthy()

    st().removeFermenter(added.id)
    expect(st().fermenters).toHaveLength(n)
    expect(st().fermenters.find((f) => f.id === added.id)).toBeUndefined()
  })
})

describe('system-store — brew systems + coolers add/remove', () => {
  it('addBrewSystem grows / removeBrewSystem shrinks', () => {
    const n = st().brewSystems.length
    st().addBrewSystem()
    expect(st().brewSystems).toHaveLength(n + 1)
    const id = st().brewSystems[st().brewSystems.length - 1].id
    st().removeBrewSystem(id)
    expect(st().brewSystems).toHaveLength(n)
  })

  it('addCooler(kind) appends the requested kind; removeCooler shrinks', () => {
    const n = st().coolers.length
    st().addCooler('counterflow')
    st().addCooler('glycol')
    expect(st().coolers).toHaveLength(n + 2)
    expect(st().coolers[st().coolers.length - 1].kind).toBe('glycol')

    const id = st().coolers[st().coolers.length - 1].id
    st().removeCooler(id)
    expect(st().coolers).toHaveLength(n + 1)
  })
})

describe('system-store — cycle toggles a single instance', () => {
  it('cycleBrewSystem toggles only the targeted system', () => {
    st().addBrewSystem() // 2 brew systems now
    const [a, b] = st().brewSystems
    st().cycleBrewSystem(a.id)
    expect(st().brewSystems.find((x) => x.id === a.id)?.status).toBe('active')
    expect(st().brewSystems.find((x) => x.id === b.id)?.status).toBe('idle')
    st().cycleBrewSystem(a.id)
    expect(st().brewSystems.find((x) => x.id === a.id)?.status).toBe('idle')
  })

  it('cycleCooler toggles only the targeted cooler', () => {
    // Default coolers are glycol-only now; add a standalone counterflow so there
    // are two instances to prove the toggle isolates a single one.
    st().addCooler('counterflow')
    const cf = st().coolers.find((c) => c.kind === 'counterflow')
    const gl = st().coolers.find((c) => c.kind === 'glycol')
    expect(cf).toBeDefined()
    expect(gl).toBeDefined()
    if (!cf || !gl) return
    st().cycleCooler(cf.id)
    expect(st().coolers.find((c) => c.id === cf.id)?.status).toBe('active')
    expect(st().coolers.find((c) => c.id === gl.id)?.status).toBe('idle')
  })

  it('cycleFermenter advances a single fermenter through the flow', () => {
    const id = st().fermenters[0].id
    st().cycleFermenter(id) // empty -> fermenting
    expect(st().fermenters.find((f) => f.id === id)?.status).toBe('fermenting')
    expect(st().fermenters[1].status).toBe('empty')
  })
})

describe('system-store — reset reseeds the default rig', () => {
  it('reset restores 1 brew system, 1 glycol cooler, 4 fermenters (all idle/empty)', () => {
    st().addFermenter()
    st().addBrewSystem()
    st().addCooler('counterflow')
    st().cycleCooler(st().coolers[0].id)
    st().reset()

    expect(st().brewSystems).toHaveLength(1)
    expect(st().brewSystems[0].model).toBe('Brewtools B40pro')
    // The counterflow chiller is a B40pro component now, not a default cooler.
    expect(st().brewSystems[0].components).toContain('Counterflow Chiller')
    expect(st().coolers).toHaveLength(1)
    expect(st().coolers[0].kind).toBe('glycol')
    expect(st().coolers.every((c) => c.status === 'idle')).toBe(true)
    expect(st().fermenters).toHaveLength(4)
    expect(st().fermenters.every((f) => f.status === 'empty')).toBe(true)
  })
})

describe('system-store — persist migration v0 → v2 (scalars → arrays, counterflow folded in)', () => {
  it('folds the counterflow into the brew system, glycol-only coolers, fermenters preserved', () => {
    const legacy = {
      brew: 'active',
      wortChiller: 'idle',
      cooler: 'active',
      fermenters: [
        {
          id: 'f1',
          name: 'Fermenter 1',
          batch: 'Hazy IPA',
          status: 'fermenting',
          og: 1.05,
          sg: 1.02,
          tempTarget: 66,
        },
        { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
        { id: 'f3', name: 'Fermenter 3', batch: '', status: 'empty' },
        { id: 'f4', name: 'Fermenter 4', batch: '', status: 'empty' },
      ],
      currentBrew: { recipeName: 'Hazy IPA' },
    }

    const migrated = migrateSystemFlow(legacy, 0)

    // Brew scalar → single seeded brew system carrying its on/off + the counterflow component.
    expect(migrated.brewSystems).toHaveLength(1)
    expect(migrated.brewSystems[0].status).toBe('active')
    expect(migrated.brewSystems[0].model).toBe('Brewtools B40pro')
    expect(migrated.brewSystems[0].components).toContain('Counterflow Chiller')

    // DEFAULT coolers are glycol-only now; the old `cooler` status rides the glycol unit.
    expect(migrated.coolers).toHaveLength(1)
    expect(migrated.coolers[0].kind).toBe('glycol')
    expect(migrated.coolers[0].status).toBe('active')
    expect(migrated.coolers.some((c) => c.kind === 'counterflow')).toBe(false)

    // Fermenters + their live per-batch data survive the upgrade untouched.
    expect(migrated.fermenters).toHaveLength(4)
    expect(migrated.fermenters[0]).toMatchObject({
      batch: 'Hazy IPA',
      status: 'fermenting',
      og: 1.05,
      sg: 1.02,
    })
    expect(migrated.currentBrew).toEqual({ recipeName: 'Hazy IPA' })
  })

  it('folds an ACTIVE wort chiller into the brew-system status (brew was idle)', () => {
    const migrated = migrateSystemFlow({ brew: 'idle', wortChiller: 'active', cooler: 'idle' }, 0)
    expect(migrated.brewSystems[0].status).toBe('active')
    expect(migrated.coolers).toHaveLength(1)
    expect(migrated.coolers[0].kind).toBe('glycol')
    expect(migrated.coolers[0].status).toBe('idle')
  })
})

describe('system-store — persist migration v1 → v2 (counterflow chiller folded into brew system)', () => {
  it('drops the seeded cfc cooler, adds Counterflow Chiller to b1, preserves fermenters + user coolers', () => {
    const v1 = {
      brewSystems: [
        {
          id: 'b1',
          name: 'Brew System',
          model: 'Brewtools B40pro',
          components: ['Steam Hat', 'Recirc Pump'],
          status: 'idle',
        },
      ],
      coolers: [
        {
          id: 'cfc',
          kind: 'counterflow',
          name: 'Counterflow Cooler',
          model: 'Brewtools CFC Pro',
          components: [],
          status: 'active',
        },
        { id: 'glycol', kind: 'glycol', name: 'Glycol Cooler', components: [], status: 'idle' },
        // a user-added standalone counterflow — MUST be preserved (still valid for non-B40pro rigs)
        {
          id: 'user-cfc-1',
          kind: 'counterflow',
          name: 'My Spare CFC',
          components: [],
          status: 'idle',
        },
      ],
      fermenters: [
        { id: 'f1', name: 'Fermenter 1', batch: 'Stout', status: 'fermenting', og: 1.06, sg: 1.03 },
        { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
      ],
      currentBrew: { recipeName: 'Stout' },
    }

    const migrated = migrateSystemFlow(v1, 1)

    // The default-seeded cfc is gone; the glycol + user-added counterflow survive.
    expect(migrated.coolers.find((c) => c.id === 'cfc')).toBeUndefined()
    expect(migrated.coolers.find((c) => c.id === 'glycol')).toBeDefined()
    expect(migrated.coolers.find((c) => c.id === 'user-cfc-1')).toBeDefined()
    expect(migrated.coolers).toHaveLength(2)

    // b1 gains the Counterflow Chiller component and goes active (dropped cfc was active).
    const b1 = migrated.brewSystems.find((b) => b.id === 'b1')
    expect(b1?.components).toContain('Counterflow Chiller')
    expect(b1?.status).toBe('active')

    // Fermenters + live data are untouched.
    expect(migrated.fermenters).toHaveLength(2)
    expect(migrated.fermenters[0]).toMatchObject({
      batch: 'Stout',
      status: 'fermenting',
      og: 1.06,
      sg: 1.03,
    })
    expect(migrated.currentBrew).toEqual({ recipeName: 'Stout' })
  })

  it('does not duplicate Counterflow Chiller and keeps b1 status when the dropped cfc was idle', () => {
    const v1 = {
      brewSystems: [
        { id: 'b1', name: 'Brew System', components: ['Counterflow Chiller'], status: 'idle' },
      ],
      coolers: [
        {
          id: 'cfc',
          kind: 'counterflow',
          name: 'Counterflow Cooler',
          components: [],
          status: 'idle',
        },
      ],
      fermenters: [],
      currentBrew: null,
    }

    const migrated = migrateSystemFlow(v1, 1)
    const b1 = migrated.brewSystems.find((b) => b.id === 'b1')
    expect(b1?.components.filter((c) => c === 'Counterflow Chiller')).toHaveLength(1)
    expect(b1?.status).toBe('idle')
    expect(migrated.coolers.find((c) => c.id === 'cfc')).toBeUndefined()
  })

  it('is a passthrough for already-v2 state', () => {
    const v2 = { brewSystems: [], coolers: [], fermenters: [], currentBrew: null }
    expect(migrateSystemFlow(v2, 2)).toBe(v2)
  })
})
