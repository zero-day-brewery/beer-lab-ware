import { describe, expect, it } from 'vitest'
import { buildDashboard } from '@/lib/brewing/dashboard/build-dashboard'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { BrewSystem, Cooler, Fermenter } from '@/stores/system-store'

const NOW = new Date('2026-07-04T12:00:00.000Z')

function recipe(id: string, name: string): Recipe {
  return {
    id,
    name,
    type: 'all-grain',
    batchSize_L: 19,
    boilTime_min: 60,
    equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    schemaVersion: 1,
  }
}

function batch(over: Partial<Batch> & { id: string }): Batch {
  return {
    batchNo: 1,
    name: 'Batch',
    status: 'in-progress',
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function ferm(over: Partial<Fermenter> & { id: string }): Fermenter {
  return { name: over.id, batch: '', status: 'empty', ...over }
}

function inv(over: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return {
    ingredientKind: 'hop',
    amount: 100,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

const brewSystem = (status: BrewSystem['status']): BrewSystem => ({
  id: 'b1',
  name: 'Brew System',
  components: [],
  status,
})
const cooler = (kind: Cooler['kind'], status: Cooler['status']): Cooler => ({
  id: kind,
  kind,
  name: kind,
  components: [],
  status,
})

const EMPTY = {
  recipes: [],
  batches: [],
  fermenters: [],
  brewSystems: [],
  coolers: [],
  inventory: [],
  now: NOW,
}

describe('buildDashboard — KPIs', () => {
  it('counts recipes, in-progress batches, fermenting vessels, low-stock items', () => {
    const s = buildDashboard({
      ...EMPTY,
      recipes: [recipe('r1', 'IPA'), recipe('r2', 'Stout')],
      batches: [
        batch({ id: 'b-a', status: 'in-progress' }),
        batch({ id: 'b-b', status: 'complete' }),
        batch({ id: 'b-c', status: 'in-progress' }),
      ],
      fermenters: [
        ferm({ id: 'f1', status: 'fermenting' }),
        ferm({ id: 'f2', status: 'empty' }),
        ferm({ id: 'f3', status: 'conditioning' }),
      ],
      inventory: [
        inv({ id: 'i1', name: 'Cascade', amount: 5, lowStockThreshold: 10 }),
        inv({ id: 'i2', name: 'Citra', amount: 500 }), // no threshold → not low
      ],
    })
    expect(s.kpis).toEqual({
      recipeCount: 2,
      activeBatchCount: 2,
      vesselsFermentingCount: 2,
      lowStockCount: 1,
    })
  })
})

describe('buildDashboard — brewhouse strip', () => {
  it('derives brewing/chilling/glycol + fermenting/vessel counts', () => {
    const s = buildDashboard({
      ...EMPTY,
      brewSystems: [brewSystem('active')],
      coolers: [cooler('counterflow', 'idle'), cooler('glycol', 'active')],
      fermenters: [ferm({ id: 'f1', status: 'fermenting' }), ferm({ id: 'f2', status: 'empty' })],
    })
    expect(s.brewhouse).toEqual({
      brewing: true,
      chilling: false,
      glycol: true,
      fermentingCount: 1,
      vesselCount: 2,
    })
  })
})

describe('buildDashboard — active fermentations', () => {
  it('lists only non-empty vessels with computed vitals + matched in-progress batch id', () => {
    const s = buildDashboard({
      ...EMPTY,
      batches: [
        batch({ id: 'batch-match', recipeId: 'r1', status: 'in-progress' }),
        batch({ id: 'batch-done', recipeId: 'r1', status: 'complete' }),
      ],
      fermenters: [
        ferm({
          id: 'f1',
          batch: 'West Coast IPA',
          status: 'fermenting',
          recipeId: 'r1',
          og: 1.05,
          sg: 1.02,
          fg: 1.01,
          pitchedAt: '2026-07-01T12:00:00.000Z',
        }),
        ferm({ id: 'f2', status: 'empty' }),
      ],
    })
    expect(s.activeFermentations).toHaveLength(1)
    const af = s.activeFermentations[0]
    expect(af.name).toBe('West Coast IPA')
    expect(af.statusLabel).toBe('Fermenting')
    expect(af.sg).toBe(1.02)
    expect(af.dayN).toBe(3)
    expect(af.abv).toBeCloseTo(3.9375, 4)
    expect(af.progressPct).toBeCloseTo(75, 5)
    // Matches the in-progress batch by recipeId — NOT the completed one.
    expect(af.batchId).toBe('batch-match')
  })

  it('leaves batchId null when no in-progress batch shares the recipe', () => {
    const s = buildDashboard({
      ...EMPTY,
      fermenters: [ferm({ id: 'f1', status: 'fermenting', recipeId: 'r9' })],
    })
    expect(s.activeFermentations[0].batchId).toBeNull()
  })

  it('prefers the real Fermenter.batchId link over the recipeId heuristic', () => {
    const s = buildDashboard({
      ...EMPTY,
      batches: [
        // A recipeId match exists and would win under the old heuristic…
        batch({ id: 'batch-heuristic', recipeId: 'r1', status: 'in-progress' }),
      ],
      fermenters: [
        // …but the vessel carries an explicit stamped link → that must win.
        ferm({ id: 'f1', status: 'fermenting', recipeId: 'r1', batchId: 'batch-real' }),
      ],
    })
    expect(s.activeFermentations[0].batchId).toBe('batch-real')
  })

  it('falls back to the recipeId match when the vessel has no stamped batchId', () => {
    const s = buildDashboard({
      ...EMPTY,
      batches: [batch({ id: 'batch-match', recipeId: 'r1', status: 'in-progress' })],
      // No batchId on the fermenter → recipeId heuristic resolves the link.
      fermenters: [ferm({ id: 'f1', status: 'fermenting', recipeId: 'r1' })],
    })
    expect(s.activeFermentations[0].batchId).toBe('batch-match')
  })

  it('null when the vessel has neither a stamped batchId nor a recipeId', () => {
    const s = buildDashboard({
      ...EMPTY,
      batches: [batch({ id: 'batch-x', recipeId: 'r1', status: 'in-progress' })],
      fermenters: [ferm({ id: 'f1', status: 'fermenting' })],
    })
    expect(s.activeFermentations[0].batchId).toBeNull()
  })
})

describe('buildDashboard — attention', () => {
  it('flags low stock with a top-names detail and /inventory link', () => {
    const s = buildDashboard({
      ...EMPTY,
      inventory: [
        inv({ id: 'i1', name: 'Cascade', amount: 0, lowStockThreshold: 10 }),
        inv({ id: 'i2', name: 'Maris Otter', amount: 1, lowStockThreshold: 5 }),
      ],
    })
    const low = s.attention.items.find((i) => i.kind === 'low-stock')
    expect(low).toBeDefined()
    expect(low?.href).toBe('/inventory')
    expect(low?.tone).toBe('warn')
    expect(low?.title).toBe('2 ingredients low')
    expect(low?.detail).toContain('Cascade')
    expect(low?.detail).toContain('Maris Otter')
  })

  it('detects ready-to-cold-crash (sg <= fg + 0.002) and skips not-ready vessels', () => {
    const s = buildDashboard({
      ...EMPTY,
      fermenters: [
        ferm({
          id: 'ready',
          batch: 'Saison',
          status: 'fermenting',
          og: 1.05,
          sg: 1.011,
          fg: 1.01,
        }),
        ferm({
          id: 'notyet',
          batch: 'Porter',
          status: 'fermenting',
          og: 1.05,
          sg: 1.03,
          fg: 1.01,
        }),
      ],
    })
    const ready = s.attention.items.filter((i) => i.kind === 'ready')
    expect(ready).toHaveLength(1)
    expect(ready[0].title).toBe('Saison')
    expect(ready[0].detail).toBe('At FG — ready to cold-crash')
    expect(ready[0].href).toBe('/system')
  })

  it('surfaces up to two recent-batch notes newest-first from outcome/tasting/logs', () => {
    const s = buildDashboard({
      ...EMPTY,
      batches: [
        batch({
          id: 'b-old',
          name: 'Old Ale',
          updatedAt: '2026-06-01T00:00:00.000Z',
          outcomeNotes_md: 'Oxidized a bit.',
        }),
        batch({
          id: 'b-new',
          name: 'Fresh Pale',
          updatedAt: '2026-07-03T00:00:00.000Z',
          tasting: { flavor_md: 'Bright citrus, clean finish.' },
        }),
        batch({
          id: 'b-mid',
          name: 'Amber',
          updatedAt: '2026-07-02T00:00:00.000Z',
          logs: [{ key: 'k', label: 'OG', stepId: 's', value: 1.055, at: 'x' }],
        }),
      ],
    })
    const notes = s.attention.items.filter((i) => i.kind === 'note')
    expect(notes).toHaveLength(2)
    expect(notes[0].title).toBe('Fresh Pale')
    expect(notes[0].detail).toBe('Bright citrus, clean finish.')
    expect(notes[0].href).toBe('/logbook')
    expect(notes[1].title).toBe('Amber')
    expect(notes[1].detail).toBe('OG: 1.055')
  })

  it('still derives the batch note from overall_md when a rating is also present', () => {
    const s = buildDashboard({
      ...EMPTY,
      batches: [
        batch({
          id: 'b-rated',
          name: 'Rated Pale',
          updatedAt: '2026-07-04T00:00:00.000Z',
          tasting: { rating: 5, overall_md: 'Crisp and dry.' },
        }),
      ],
    })
    const notes = s.attention.items.filter((i) => i.kind === 'note')
    expect(notes).toHaveLength(1)
    // rating is additive — the note text still comes from overall_md, unaffected.
    expect(notes[0].detail).toBe('Crisp and dry.')
  })

  it('assembles low-stock, ready, and notes together in order', () => {
    const s = buildDashboard({
      ...EMPTY,
      inventory: [inv({ id: 'i1', name: 'Cascade', amount: 0, lowStockThreshold: 10 })],
      fermenters: [
        ferm({ id: 'ready', batch: 'Saison', status: 'fermenting', og: 1.05, sg: 1.011, fg: 1.01 }),
      ],
      batches: [batch({ id: 'b1', name: 'Fresh Pale', outcomeNotes_md: 'Great.' })],
    })
    expect(s.attention.allClear).toBe(false)
    expect(s.attention.items.map((i) => i.kind)).toEqual(['low-stock', 'ready', 'note'])
  })

  it('reports all-clear when nothing needs attention', () => {
    const s = buildDashboard({
      ...EMPTY,
      recipes: [recipe('r1', 'IPA')],
      fermenters: [ferm({ id: 'f1', status: 'fermenting', og: 1.05, sg: 1.03, fg: 1.01 })],
      inventory: [inv({ id: 'i1', name: 'Citra', amount: 500 })],
    })
    expect(s.attention.items).toHaveLength(0)
    expect(s.attention.allClear).toBe(true)
  })
})
