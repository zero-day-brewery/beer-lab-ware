import { describe, expect, it } from 'vitest'
import {
  applyRememberedLinks,
  buildDeductionPlan,
  catalogKindToInventoryKind,
  type DeductionLine,
  withMatch,
} from '@/lib/brewing/inventory/deduction'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { FermentableUse, HopUse, MiscUse, YeastUse } from '@/lib/brewing/types/recipe-parts'

// ── Factories ──────────────────────────────────────────────────────────────
const NOW = '2026-07-05T00:00:00.000Z'

function ferm(over: Partial<FermentableUse> = {}): FermentableUse {
  return {
    ingredientId: 'f0000000-0000-4000-8000-000000000001',
    snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
    amount_kg: 5,
    usage: 'mash',
    afterBoil: false,
    ...over,
  }
}
function hop(over: Partial<HopUse> = {}): HopUse {
  return {
    ingredientId: 'f0000000-0000-4000-8000-000000000002',
    snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
    amount_g: 28,
    time_min: 60,
    use: 'boil',
    ...over,
  }
}
function yeast(over: Partial<YeastUse> = {}): YeastUse {
  return {
    ingredientId: 'f0000000-0000-4000-8000-000000000003',
    snapshot: { name: 'US-05', attenuation_min_pct: 78, attenuation_max_pct: 82, form: 'dry' },
    amount: 1,
    ...over,
  }
}
function misc(over: Partial<MiscUse> = {}): MiscUse {
  return {
    ingredientId: 'f0000000-0000-4000-8000-000000000004',
    snapshot: { name: 'Irish Moss', type: 'fining' },
    amount: 5,
    amountUnit: 'g',
    use: 'boil',
    time_min: 15,
    ...over,
  }
}

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'e0000000-0000-4000-8000-000000000000',
    name: 'Test IPA',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: 'e0000000-0000-4000-8000-0000000000ee',
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...over,
  }
}

function batch(snapshot: Recipe | undefined, over: Partial<Batch> = {}): Batch {
  return {
    id: 'b0000000-0000-4000-8000-000000000000',
    batchNo: 1,
    name: 'Batch #1',
    status: 'in-progress',
    recipeId: snapshot?.id,
    recipeSnapshot: snapshot,
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...over,
  }
}

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: '2-Row Pale',
    ingredientKind: 'fermentable',
    amount: 10,
    amountUnit: 'kg',
    status: 'sealed',
    notes_md: '',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...over,
  }
}

// ── catalogKindToInventoryKind ───────────────────────────────────────────────
describe('catalogKindToInventoryKind', () => {
  it('maps water → water-treatment; identity otherwise', () => {
    expect(catalogKindToInventoryKind('water')).toBe('water-treatment')
    expect(catalogKindToInventoryKind('fermentable')).toBe('fermentable')
    expect(catalogKindToInventoryKind('hop')).toBe('hop')
    expect(catalogKindToInventoryKind('yeast')).toBe('yeast')
    expect(catalogKindToInventoryKind('misc')).toBe('misc')
  })
})

// ── buildDeductionPlan ───────────────────────────────────────────────────────
describe('buildDeductionPlan — matching + conversion', () => {
  it('returns [] when the batch has no recipe snapshot', () => {
    expect(buildDeductionPlan({ batch: batch(undefined), items: [] })).toEqual([])
  })

  it('name+kind match: fermentable kg → inventory g draw, ok status', () => {
    const items = [item({ name: '2-Row Pale', amountUnit: 'g', amount: 6000 })]
    const plan = buildDeductionPlan({
      batch: batch(recipe({ fermentables: [ferm({ amount_kg: 5 })] })),
      items,
    })
    expect(plan).toHaveLength(1)
    const l = plan[0]
    expect(l.status).toBe('ok')
    expect(l.matchedItemId).toBe(items[0].id)
    expect(l.draw).toBe(5000) // 5 kg → 5000 g
    expect(l.drawUnit).toBe('g')
    expect(l.resultingBalance).toBe(1000)
    expect(l.recipeUseRef).toEqual({ ingredientId: ferm().ingredientId, line: 'fermentable' })
  })

  it('match is case-insensitive on name', () => {
    const items = [item({ name: '2-ROW pale' })]
    const plan = buildDeductionPlan({ batch: batch(recipe({ fermentables: [ferm()] })), items })
    expect(plan[0].status).toBe('ok')
    expect(plan[0].matchedItemId).toBe(items[0].id)
  })

  it('short: draw exceeds on-hand → negative resultingBalance', () => {
    const items = [item({ name: '2-Row Pale', amountUnit: 'kg', amount: 2 })]
    const plan = buildDeductionPlan({
      batch: batch(recipe({ fermentables: [ferm({ amount_kg: 5 })] })),
      items,
    })
    expect(plan[0].status).toBe('short')
    expect(plan[0].draw).toBe(5)
    expect(plan[0].resultingBalance).toBe(-3)
  })

  it('hop grams match', () => {
    const items = [
      item({
        id: 'a0000000-0000-4000-8000-0000000000h1',
        name: 'Cascade',
        ingredientKind: 'hop',
        amountUnit: 'g',
        amount: 100,
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(recipe({ hops: [hop({ amount_g: 28 })] })),
      items,
    })
    expect(plan[0].line).toBe('hop')
    expect(plan[0].status).toBe('ok')
    expect(plan[0].draw).toBe(28)
    expect(plan[0].resultingBalance).toBe(72)
  })

  it('yeast count match against a packets item (count 1:1)', () => {
    const items = [
      item({
        id: 'a0000000-0000-4000-8000-0000000000y1',
        name: 'US-05',
        ingredientKind: 'yeast',
        amountUnit: 'packets',
        amount: 3,
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(recipe({ yeasts: [yeast({ amount: 1 })] })),
      items,
    })
    expect(plan[0].line).toBe('yeast')
    expect(plan[0].status).toBe('ok')
    expect(plan[0].draw).toBe(1)
    expect(plan[0].resultingBalance).toBe(2)
  })

  it('misc ml match', () => {
    const items = [
      item({
        id: 'a0000000-0000-4000-8000-0000000000m1',
        name: 'Lactic Acid',
        ingredientKind: 'misc',
        amountUnit: 'ml',
        amount: 100,
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(
        recipe({
          miscs: [
            misc({ snapshot: { name: 'Lactic Acid', type: 'other' }, amount: 5, amountUnit: 'ml' }),
          ],
        }),
      ),
      items,
    })
    expect(plan[0].status).toBe('ok')
    expect(plan[0].draw).toBe(5)
    expect(plan[0].resultingBalance).toBe(95)
  })

  it('mismatch: misc tsp cannot convert to a g item', () => {
    const items = [
      item({
        id: 'a0000000-0000-4000-8000-0000000000m2',
        name: 'Gelatin',
        ingredientKind: 'misc',
        amountUnit: 'g',
        amount: 50,
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(
        recipe({
          miscs: [
            misc({ snapshot: { name: 'Gelatin', type: 'fining' }, amount: 2, amountUnit: 'tsp' }),
          ],
        }),
      ),
      items,
    })
    expect(plan[0].status).toBe('mismatch')
    expect(plan[0].matchedItemId).toBe(items[0].id) // matched, but not convertible
    expect(plan[0].draw).toBeNull()
    expect(plan[0].resultingBalance).toBeNull()
  })

  it('water-agent misc maps to the water-treatment inventory bucket', () => {
    const items = [
      item({
        id: 'a0000000-0000-4000-8000-0000000000w1',
        name: 'Gypsum',
        ingredientKind: 'water-treatment',
        amountUnit: 'g',
        amount: 500,
      }),
      // a same-named misc-kind item must NOT be matched for a water-agent line
      item({
        id: 'a0000000-0000-4000-8000-0000000000w2',
        name: 'Gypsum',
        ingredientKind: 'misc',
        amountUnit: 'g',
        amount: 999,
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(
        recipe({
          miscs: [
            misc({ snapshot: { name: 'Gypsum', type: 'water-agent' }, amount: 5, amountUnit: 'g' }),
          ],
        }),
      ),
      items,
    })
    expect(plan[0].inventoryKind).toBe('water-treatment')
    expect(plan[0].matchedItemId).toBe('a0000000-0000-4000-8000-0000000000w1')
    expect(plan[0].status).toBe('ok')
    expect(plan[0].draw).toBe(5)
  })

  it('unmatched: no inventory item of the right kind → candidates are kind-filtered', () => {
    const items = [
      item({
        id: 'a0000000-0000-4000-8000-0000000000c1',
        name: 'Cascade',
        ingredientKind: 'hop',
        amountUnit: 'g',
        amount: 50,
      }),
      item({
        id: 'a0000000-0000-4000-8000-0000000000c2',
        name: 'Citra',
        ingredientKind: 'hop',
        amountUnit: 'g',
        amount: 40,
      }),
      item({
        id: 'a0000000-0000-4000-8000-0000000000c3',
        name: '2-Row',
        ingredientKind: 'fermentable',
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(
        recipe({
          hops: [hop({ snapshot: { name: 'Simcoe', alphaAcid_pct: 13, form: 'pellet' } })],
        }),
      ),
      items,
    })
    expect(plan[0].status).toBe('unmatched')
    expect(plan[0].matchedItemId).toBeNull()
    expect(plan[0].candidates.map((c) => c.name).sort()).toEqual(['Cascade', 'Citra'])
  })

  it('remembered link wins over name: matches by id even when the name changed', () => {
    const linkedId = 'a0000000-0000-4000-8000-00000000link'
    const items = [
      item({ id: linkedId, name: 'Maris Otter (2023 lot)', amountUnit: 'kg', amount: 8 }),
      item({
        id: 'a0000000-0000-4000-8000-00000000nm',
        name: 'Maris Otter',
        amountUnit: 'kg',
        amount: 4,
      }),
    ]
    const plan = buildDeductionPlan({
      batch: batch(
        recipe({
          fermentables: [
            ferm({
              snapshot: { name: 'Maris Otter', type: 'base', ppg: 38, color_L: 3 },
              amount_kg: 3,
              inventoryItemId: linkedId,
            }),
          ],
        }),
      ),
      items,
    })
    expect(plan[0].matchedItemId).toBe(linkedId)
    expect(plan[0].resultingBalance).toBe(5) // 8 − 3, from the linked (not name-matched) item
  })

  it('stale remembered link (item deleted) falls back to name match', () => {
    const items = [item({ name: '2-Row Pale', amountUnit: 'kg', amount: 9 })]
    const plan = buildDeductionPlan({
      batch: batch(
        recipe({
          fermentables: [
            ferm({ amount_kg: 4, inventoryItemId: 'a0000000-0000-4000-8000-0000gone0000' }),
          ],
        }),
      ),
      items,
    })
    expect(plan[0].matchedItemId).toBe(items[0].id)
    expect(plan[0].status).toBe('ok')
    expect(plan[0].resultingBalance).toBe(5)
  })
})

// ── withMatch (per-line re-resolution) ───────────────────────────────────────
describe('withMatch', () => {
  const base = (): DeductionLine => ({
    ingredientId: 'x',
    line: 'hop',
    name: 'Cascade',
    recipeQty: 28,
    recipeUnit: 'g',
    inventoryKind: 'hop',
    matchedItemId: null,
    matchedItem: null,
    draw: null,
    drawUnit: null,
    resultingBalance: null,
    status: 'unmatched',
    candidates: [],
    recipeUseRef: { ingredientId: 'x', line: 'hop' },
  })

  it('null clears the match → unmatched', () => {
    const l = withMatch({ ...base(), status: 'ok', matchedItemId: 'z' }, null)
    expect(l.status).toBe('unmatched')
    expect(l.matchedItemId).toBeNull()
    expect(l.draw).toBeNull()
  })
  it('choosing a compatible item recomputes draw + status', () => {
    const l = withMatch(
      base(),
      item({ id: 'z', ingredientKind: 'hop', amountUnit: 'g', amount: 100 }),
    )
    expect(l.status).toBe('ok')
    expect(l.draw).toBe(28)
    expect(l.resultingBalance).toBe(72)
  })
  it('choosing a cross-dimension item → mismatch', () => {
    const l = withMatch(
      base(),
      item({ id: 'z', ingredientKind: 'hop', amountUnit: 'ml', amount: 100 }),
    )
    expect(l.status).toBe('mismatch')
    expect(l.draw).toBeNull()
  })
})

// ── applyRememberedLinks (write-back transform) ──────────────────────────────
describe('applyRememberedLinks', () => {
  function matchedLine(over: Partial<DeductionLine>): DeductionLine {
    return {
      ingredientId: 'f0000000-0000-4000-8000-000000000001',
      line: 'fermentable',
      name: '2-Row Pale',
      recipeQty: 5,
      recipeUnit: 'kg',
      inventoryKind: 'fermentable',
      matchedItemId: 'a0000000-0000-4000-8000-000000000001',
      matchedItem: null,
      draw: 5,
      drawUnit: 'kg',
      resultingBalance: 5,
      status: 'ok',
      candidates: [],
      recipeUseRef: { ingredientId: 'f0000000-0000-4000-8000-000000000001', line: 'fermentable' },
      ...over,
    }
  }

  it('stamps inventoryItemId onto the use matched by ingredientId + section', () => {
    const r = recipe({ fermentables: [ferm()] })
    const { recipe: next, changed } = applyRememberedLinks(r, [matchedLine({})])
    expect(changed).toBe(true)
    expect(next.fermentables[0].inventoryItemId).toBe('a0000000-0000-4000-8000-000000000001')
  })

  it('no-op (changed=false) when there are no matched lines', () => {
    const r = recipe({ fermentables: [ferm()] })
    const { recipe: next, changed } = applyRememberedLinks(r, [])
    expect(changed).toBe(false)
    expect(next.fermentables[0].inventoryItemId).toBeUndefined()
  })

  it('no-op when the link is already the same id', () => {
    const r = recipe({
      fermentables: [ferm({ inventoryItemId: 'a0000000-0000-4000-8000-000000000001' })],
    })
    const { changed } = applyRememberedLinks(r, [matchedLine({})])
    expect(changed).toBe(false)
  })

  it('does not touch a use whose ingredientId is not in the lines', () => {
    const r = recipe({
      fermentables: [ferm({ ingredientId: 'f0000000-0000-4000-8000-0000000000zz' })],
    })
    const { changed, recipe: next } = applyRememberedLinks(r, [matchedLine({})])
    expect(changed).toBe(false)
    expect(next.fermentables[0].inventoryItemId).toBeUndefined()
  })

  it('ignores unmatched/mismatch lines (matchedItemId null)', () => {
    const r = recipe({ fermentables: [ferm()] })
    const { changed } = applyRememberedLinks(r, [
      matchedLine({ matchedItemId: null, status: 'unmatched' }),
    ])
    expect(changed).toBe(false)
  })
})
