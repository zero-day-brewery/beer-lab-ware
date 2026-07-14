import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTools } from '@/lib/ai/tools'
import type { ToolDeps } from '@/lib/ai/tools/deps'
import type { AiTool } from '@/lib/ai/types'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE, B40PRO_PROFILE_ID } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Water } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { makeEquipmentRepo } from '@/lib/db/repos/equipment'
import { makeGearRepo } from '@/lib/db/repos/gear'
import { makeInventoryRepo } from '@/lib/db/repos/inventory'
import { makeReadingsRepo } from '@/lib/db/repos/readings'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { makeWaterRepo } from '@/lib/db/repos/water'
import { BrewDB } from '@/lib/db/schema'

// ── valid v4 UUIDs (version nibble 4, variant nibble 8) ────────────────────
const RECIPE_ID = '11111111-1111-4111-8111-111111111111'
const FERM_ING = '44444444-4444-4444-8444-444444444444'
const HOP_ING = '22222222-2222-4222-8222-222222222222'
const YEAST_ING = '33333333-3333-4333-8333-333333333333'
const INV_ID = '55555555-5555-4555-8555-555555555555'
const WATER_ID = '66666666-6666-4666-8666-666666666666'
const BATCH_ID = '77777777-7777-4777-8777-777777777777'
const READ_ID1 = '88888888-8888-4888-8888-888888888888'
const READ_ID2 = '99999999-9999-4999-8999-999999999999'

const NOW = new Date('2026-07-05T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()

const recipe: Recipe = {
  id: RECIPE_ID,
  name: 'SMaSH Pale',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: B40PRO_PROFILE_ID,
  fermentables: [
    {
      ingredientId: FERM_ING,
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: HOP_ING,
      snapshot: { name: 'Cascade', alphaAcid_pct: 6.5, form: 'pellet' },
      amount_g: 40,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [
    {
      ingredientId: YEAST_ING,
      snapshot: { name: 'US-05', attenuation_min_pct: 78, attenuation_max_pct: 82, form: 'dry' },
      amount: 1,
    },
  ],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
}

const invItem: InventoryItem = {
  id: INV_ID,
  name: 'Cascade',
  ingredientKind: 'hop',
  amount: 50,
  amountUnit: 'g',
  lowStockThreshold: 100,
  parLevel: 200,
  pricePerUnit_USD: 0.05,
  status: 'sealed',
  notes_md: '',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  schemaVersion: 1,
}

const water: Water = {
  id: WATER_ID,
  kind: 'water',
  name: 'RO',
  Ca_ppm: 5,
  Mg_ppm: 1,
  Na_ppm: 2,
  SO4_ppm: 3,
  Cl_ppm: 4,
  HCO3_ppm: 5,
}

const batch: Batch = {
  id: BATCH_ID,
  batchNo: 1,
  name: 'SMaSH #1',
  status: 'complete',
  recipeId: RECIPE_ID,
  recipeSnapshot: recipe,
  equipmentSnapshot: B40PRO_PROFILE,
  computedTargets: calculateRecipe(recipe, B40PRO_PROFILE, NOW_ISO),
  process: [],
  logs: [],
  timers: [],
  results: { measuredABV: 5.4, measuredOG: 1.05, measuredFG: 1.011 },
  tasting: { rating: 4, overall_md: 'Clean and crisp.' },
  startedAt: '2026-06-25T12:00:00.000Z',
  brewedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-26T12:00:00.000Z',
  schemaVersion: 1,
}

const readings: Reading[] = [
  {
    id: READ_ID1,
    batchId: BATCH_ID,
    at: '2026-06-27T00:00:00.000Z',
    gravity: 1.04,
    tempC: 19,
    schemaVersion: 1,
  },
  {
    id: READ_ID2,
    batchId: BATCH_ID,
    at: '2026-06-30T00:00:00.000Z',
    gravity: 1.012,
    tempC: 20,
    ph: 4.4,
    schemaVersion: 1,
  },
]

function fakeDeps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    recipes: { list: async () => [], get: async () => null },
    inventory: { list: async () => [] },
    gear: { list: async () => [] },
    batches: { list: async () => [], get: async () => null },
    readings: { listByBatch: async () => [] },
    water: { list: async () => [], get: async () => null },
    equipment: { list: async () => [], get: async () => null, getDefault: async () => null },
    now: () => NOW,
    ...over,
  }
}

function toolByName(tools: AiTool[], name: string): AiTool {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return t
}

describe('read-only tool registry (injected fake repos)', () => {
  it('exposes exactly the 11 read-only tools, each with a JSON input schema', () => {
    const tools = buildTools(fakeDeps())
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'batch_stats',
        'calc_recipe',
        'get_batch',
        'get_recipe',
        'inventory_report',
        'list_batches',
        'list_equipment',
        'list_inventory',
        'list_recipes',
        'list_water_profiles',
        'water_additions',
      ].sort(),
    )
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: 'object' })
      expect(typeof t.description).toBe('string')
    }
  })

  it('list_recipes → recipeRepo.list, returns a lean summary with ingredient counts', async () => {
    const tools = buildTools(
      fakeDeps({ recipes: { list: async () => [recipe], get: async () => recipe } }),
    )
    const out = (await toolByName(tools, 'list_recipes').run({})) as Array<Record<string, unknown>>
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: RECIPE_ID,
      name: 'SMaSH Pale',
      fermentableCount: 1,
      hopCount: 1,
      yeastCount: 1,
    })
    // Lean: no raw fermentables blob leaked.
    expect(out[0]).not.toHaveProperty('fermentables')
  })

  it('get_recipe → recipeRepo.get + calculateRecipe, returns computed vitals', async () => {
    const tools = buildTools(
      fakeDeps({
        recipes: { list: async () => [recipe], get: async () => recipe },
        equipment: {
          list: async () => [B40PRO_PROFILE],
          get: async (id) => (id === B40PRO_PROFILE_ID ? B40PRO_PROFILE : null),
          getDefault: async () => B40PRO_PROFILE,
        },
      }),
    )
    const out = (await toolByName(tools, 'get_recipe').run({ id: RECIPE_ID })) as {
      computed: { OG: number; ABV: number; IBU: number } | null
      computedWith: string | null
      hops: Array<{ name: string }>
    }
    expect(out.computed).not.toBeNull()
    expect(out.computed?.OG).toBeGreaterThan(1)
    expect(out.computed?.ABV).toBeGreaterThan(0)
    expect(out.computed?.IBU).toBeGreaterThan(0)
    expect(out.computedWith).toBe(B40PRO_PROFILE.name)
    expect(out.hops[0]?.name).toBe('Cascade')
  })

  it('get_recipe → null when the id is unknown (no throw)', async () => {
    const tools = buildTools(fakeDeps())
    await expect(toolByName(tools, 'get_recipe').run({ id: RECIPE_ID })).resolves.toBeNull()
  })

  it('list_inventory → inventoryRepo.list with lowStock flag + optional kind filter', async () => {
    const tools = buildTools(fakeDeps({ inventory: { list: async () => [invItem] } }))
    const all = (await toolByName(tools, 'list_inventory').run({})) as Array<
      Record<string, unknown>
    >
    expect(all[0]).toMatchObject({ name: 'Cascade', lowStock: true })
    const yeast = (await toolByName(tools, 'list_inventory').run({ kind: 'yeast' })) as unknown[]
    expect(yeast).toHaveLength(0)
  })

  it('inventory_report → buildInventoryReport + buildInventoryStats (value + shopping list)', async () => {
    const tools = buildTools(fakeDeps({ inventory: { list: async () => [invItem] } }))
    const out = (await toolByName(tools, 'inventory_report').run({})) as {
      totalItems: number
      totalValue_USD: number
      lowStockCount: number
      shopping: Array<{ name: string; deficit: number; estCost_USD: number }>
    }
    expect(out.totalItems).toBe(1)
    expect(out.totalValue_USD).toBeCloseTo(2.5, 5) // 50 g × $0.05
    expect(out.lowStockCount).toBe(1)
    expect(out.shopping[0]).toMatchObject({ name: 'Cascade', deficit: 150 }) // par 200 − 50
    expect(out.shopping[0]?.estCost_USD).toBeCloseTo(7.5, 5)
  })

  it('list_batches → batchRepo.list, lean summary', async () => {
    const tools = buildTools(
      fakeDeps({ batches: { list: async () => [batch], get: async () => batch } }),
    )
    const out = (await toolByName(tools, 'list_batches').run({})) as Array<Record<string, unknown>>
    expect(out[0]).toMatchObject({ batchNo: 1, status: 'complete', measuredABV: 5.4, rating: 4 })
  })

  it('get_batch → batchRepo.get + readingsRepo.listByBatch + diffRecipes drift', async () => {
    const drifted: Recipe = { ...recipe, batchSize_L: 23 }
    const tools = buildTools(
      fakeDeps({
        batches: { list: async () => [batch], get: async () => batch },
        readings: { listByBatch: async () => readings },
        recipes: { list: async () => [drifted], get: async () => drifted },
      }),
    )
    const out = (await toolByName(tools, 'get_batch').run({ id: BATCH_ID })) as {
      readingCount: number
      readings: Array<{ gravity?: number }>
      tasting?: { rating?: number }
      recipeDrift: { changed: boolean; fields: Array<{ label: string }> } | null
    }
    expect(out.readingCount).toBe(2)
    expect(out.readings[1]?.gravity).toBe(1.012)
    expect(out.tasting?.rating).toBe(4)
    expect(out.recipeDrift?.changed).toBe(true)
    expect(out.recipeDrift?.fields.some((f) => f.label === 'Batch size')).toBe(true)
  })

  it('list_water_profiles → waterRepo.list with SO4:Cl balance band', async () => {
    const tools = buildTools(
      fakeDeps({ water: { list: async () => [water], get: async () => water } }),
    )
    const out = (await toolByName(tools, 'list_water_profiles').run({})) as Array<
      Record<string, unknown>
    >
    expect(out[0]).toMatchObject({ name: 'RO', SO4_ppm: 3, Cl_ppm: 4 })
    expect(typeof out[0]?.balance).toBe('string')
  })

  it('water_additions → waterRepo.get + computeAdditions (grams + result ions)', async () => {
    const tools = buildTools(
      fakeDeps({ water: { list: async () => [water], get: async () => water } }),
    )
    const out = (await toolByName(tools, 'water_additions').run({
      profileId: WATER_ID,
      targetStyle: 'balanced',
      volume_L: 30,
    })) as {
      grams: Record<string, number>
      resultIons: { Ca_ppm: number }
      warnings: string[]
    }
    expect(out.grams).toHaveProperty('gypsum')
    expect(out.grams.gypsum).toBeGreaterThanOrEqual(0)
    expect(out.resultIons.Ca_ppm).toBeGreaterThan(water.Ca_ppm) // salts add calcium
    expect(Array.isArray(out.warnings)).toBe(true)
  })

  it('water_additions → null when the profile id is unknown', async () => {
    const tools = buildTools(fakeDeps())
    await expect(
      toolByName(tools, 'water_additions').run({
        profileId: WATER_ID,
        targetStyle: 'balanced',
        volume_L: 30,
      }),
    ).resolves.toBeNull()
  })

  it('calc_recipe → calculateRecipe what-if (nothing saved), uses recipe equipment', async () => {
    const tools = buildTools(
      fakeDeps({
        equipment: {
          list: async () => [B40PRO_PROFILE],
          get: async (id) => (id === B40PRO_PROFILE_ID ? B40PRO_PROFILE : null),
          getDefault: async () => B40PRO_PROFILE,
        },
      }),
    )
    const out = (await toolByName(tools, 'calc_recipe').run({ recipe })) as {
      computedWith: string
      computed: { OG: number; ABV: number }
    }
    expect(out.computedWith).toBe(B40PRO_PROFILE.name)
    expect(out.computed.OG).toBeGreaterThan(1)
    expect(out.computed.ABV).toBeGreaterThan(0)
  })

  it('calc_recipe → { error } when no equipment profile is available', async () => {
    const tools = buildTools(fakeDeps())
    const out = (await toolByName(tools, 'calc_recipe').run({ recipe })) as { error?: string }
    expect(out.error).toMatch(/equipment/i)
  })

  it('batch_stats → buildBatchStats roll-up', async () => {
    const tools = buildTools(
      fakeDeps({ batches: { list: async () => [batch], get: async () => batch } }),
    )
    const out = (await toolByName(tools, 'batch_stats').run({})) as {
      total: number
      byStatus: Record<string, number>
      avgRating: number | null
    }
    expect(out.total).toBe(1)
    expect(out.byStatus.complete).toBe(1)
    expect(out.avgRating).toBe(4)
  })

  it('list_equipment → equipmentRepo.list, lean profile view', async () => {
    const tools = buildTools(
      fakeDeps({
        equipment: {
          list: async () => [B40PRO_PROFILE],
          get: async () => B40PRO_PROFILE,
          getDefault: async () => B40PRO_PROFILE,
        },
      }),
    )
    const out = (await toolByName(tools, 'list_equipment').run({})) as Array<
      Record<string, unknown>
    >
    expect(out[0]).toMatchObject({
      name: B40PRO_PROFILE.name,
      isDefault: true,
      ibuFormula: 'tinseth',
    })
  })

  describe('Zod input validation rejects bad args', () => {
    const tools = buildTools(fakeDeps())
    it('get_recipe rejects a non-uuid id', async () => {
      await expect(toolByName(tools, 'get_recipe').run({ id: 'not-a-uuid' })).rejects.toThrow()
    })
    it('get_recipe rejects a missing id', async () => {
      await expect(toolByName(tools, 'get_recipe').run({})).rejects.toThrow()
    })
    it('water_additions rejects an unknown target style', async () => {
      await expect(
        toolByName(tools, 'water_additions').run({
          profileId: WATER_ID,
          targetStyle: 'nope',
          volume_L: 30,
        }),
      ).rejects.toThrow()
    })
    it('water_additions rejects a non-positive volume', async () => {
      await expect(
        toolByName(tools, 'water_additions').run({
          profileId: WATER_ID,
          targetStyle: 'balanced',
          volume_L: 0,
        }),
      ).rejects.toThrow()
    })
    it('calc_recipe rejects an incomplete recipe draft', async () => {
      await expect(
        toolByName(tools, 'calc_recipe').run({ recipe: { name: 'x' } }),
      ).rejects.toThrow()
    })
    it('list_inventory rejects an unknown kind', async () => {
      await expect(toolByName(tools, 'list_inventory').run({ kind: 'bogus' })).rejects.toThrow()
    })
  })
})

describe('read-only tool registry (real Dexie repos via fake-indexeddb)', () => {
  let db: BrewDB
  let deps: ToolDeps

  beforeEach(async () => {
    db = new BrewDB('ai-tools-itest')
    await db.open()
    deps = {
      recipes: makeRecipeRepo(db),
      inventory: makeInventoryRepo(db),
      gear: makeGearRepo(db),
      batches: makeBatchRepo(db),
      readings: makeReadingsRepo(db),
      water: makeWaterRepo(db),
      equipment: makeEquipmentRepo(db),
      now: () => NOW,
    }
    await makeEquipmentRepo(db).save(B40PRO_PROFILE)
    await makeRecipeRepo(db).save(recipe)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('ai-tools-itest')
  })

  it('list_recipes + get_recipe run end-to-end against a real Dexie-backed repo', async () => {
    const tools = buildTools(deps)
    const list = (await toolByName(tools, 'list_recipes').run({})) as Array<{
      id: string
      name: string
    }>
    expect(list.some((r) => r.id === RECIPE_ID)).toBe(true)

    const got = (await toolByName(tools, 'get_recipe').run({ id: RECIPE_ID })) as {
      name: string
      computed: { OG: number } | null
    }
    expect(got.name).toBe('SMaSH Pale')
    expect(got.computed?.OG).toBeGreaterThan(1)
  })
})
