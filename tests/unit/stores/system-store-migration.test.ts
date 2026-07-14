// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useSystemStore } from '@/stores/system-store'

// End-to-end proof that the persist config actually runs the migration when a
// real pre-v1 blob is in localStorage — an existing user's data must survive.
describe('system-store — persist rehydrate migration (localStorage v0 → v2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('upgrades a real v0 localStorage blob on rehydrate, preserving fermenters', async () => {
    localStorage.setItem(
      'brew-system-flow',
      JSON.stringify({
        version: 0,
        state: {
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
            },
            { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
            { id: 'f3', name: 'Fermenter 3', batch: '', status: 'empty' },
            { id: 'f4', name: 'Fermenter 4', batch: '', status: 'empty' },
          ],
          currentBrew: { recipeName: 'Hazy IPA' },
        },
      }),
    )

    await useSystemStore.persist.rehydrate()
    const s = useSystemStore.getState()

    expect(s.brewSystems).toHaveLength(1)
    expect(s.brewSystems[0].status).toBe('active')
    // Counterflow chiller is folded into the B40pro brew system as a component now.
    expect(s.brewSystems[0].components).toContain('Counterflow Chiller')

    // DEFAULT coolers are glycol-only; the old `cooler: active` status rides the glycol unit.
    expect(s.coolers).toHaveLength(1)
    expect(s.coolers[0].kind).toBe('glycol')
    expect(s.coolers[0].status).toBe('active')
    expect(s.coolers.some((c) => c.kind === 'counterflow')).toBe(false)

    expect(s.fermenters).toHaveLength(4)
    expect(s.fermenters[0].batch).toBe('Hazy IPA')
    expect(s.fermenters[0].status).toBe('fermenting')
    expect(s.fermenters[0].og).toBe(1.05)
  })
})
