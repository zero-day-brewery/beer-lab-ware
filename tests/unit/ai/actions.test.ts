import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ActionWriteDeps, applyAction } from '@/lib/ai/actions/apply'
import type { ActionDescriptor, Proposal } from '@/lib/ai/actions/types'
import { buildAllTools, buildTools } from '@/lib/ai/tools'
import type { ToolDeps } from '@/lib/ai/tools/deps'
import { buildWriteTools } from '@/lib/ai/tools/write-tools'
import type { AiTool } from '@/lib/ai/types'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE, B40PRO_PROFILE_ID } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { makeEquipmentRepo } from '@/lib/db/repos/equipment'
import { makeGearRepo } from '@/lib/db/repos/gear'
import { makeInventoryRepo } from '@/lib/db/repos/inventory'
import { makeReadingsRepo } from '@/lib/db/repos/readings'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { makeWaterRepo } from '@/lib/db/repos/water'
import { BrewDB } from '@/lib/db/schema'

// ── valid v4 UUIDs ─────────────────────────────────────────────────────────
const RECIPE_ID = '11111111-1111-4111-8111-111111111111'
const FERM_ING = '44444444-4444-4444-8444-444444444444'
const HOP_ING = '22222222-2222-4222-8222-222222222222'
const YEAST_ING = '33333333-3333-4333-8333-333333333333'
const INV_ID = '55555555-5555-4555-8555-555555555555'
const BATCH_ID = '77777777-7777-4777-8777-777777777777'
const MISSING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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

const batch: Batch = {
  id: BATCH_ID,
  batchNo: 1,
  name: 'SMaSH #1',
  status: 'in-progress',
  recipeId: RECIPE_ID,
  recipeSnapshot: recipe,
  equipmentSnapshot: B40PRO_PROFILE,
  computedTargets: calculateRecipe(recipe, B40PRO_PROFILE, NOW_ISO),
  process: [],
  logs: [],
  timers: [],
  results: {},
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-26T12:00:00.000Z',
  schemaVersion: 1,
}

function toolByName(tools: AiTool[], name: string): AiTool {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return t
}

function fakeReadDeps(over: Partial<ToolDeps> = {}): ToolDeps {
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

const WRITE_TOOL_NAMES = [
  'propose_adjust_inventory',
  'propose_create_recipe',
  'propose_log_reading',
  'propose_scale_recipe',
]

describe('v1 read-only tool set stays write-free', () => {
  it('buildTools contains NO propose_* (write) tools', () => {
    const read = buildTools(fakeReadDeps())
    expect(read.some((t) => t.name.startsWith('propose_'))).toBe(false)
  })

  it('buildAllTools = the read set + exactly the four propose tools', () => {
    const read = buildTools(fakeReadDeps()).map((t) => t.name)
    const all = buildAllTools(fakeReadDeps())
    const proposeNames = all
      .filter((t) => t.name.startsWith('propose_'))
      .map((t) => t.name)
      .sort()
    expect(proposeNames).toEqual(WRITE_TOOL_NAMES)
    // Every read tool still present + unchanged count.
    for (const name of read) expect(all.some((t) => t.name === name)).toBe(true)
    expect(all).toHaveLength(read.length + WRITE_TOOL_NAMES.length)
  })

  it('every propose tool advertises an object JSON input schema', () => {
    for (const t of buildWriteTools(fakeReadDeps())) {
      expect(t.inputSchema).toMatchObject({ type: 'object' })
      expect(typeof t.description).toBe('string')
    }
  })
})

describe('propose tools build well-formed proposals (fake read deps)', () => {
  const deps = fakeReadDeps({
    recipes: { list: async () => [recipe], get: async () => recipe },
    inventory: { list: async () => [invItem] },
    batches: { list: async () => [batch], get: async () => batch },
    equipment: {
      list: async () => [B40PRO_PROFILE],
      get: async (id) => (id === B40PRO_PROFILE_ID ? B40PRO_PROFILE : null),
      getDefault: async () => B40PRO_PROFILE,
    },
  })

  it('propose_scale_recipe (batch size) → payload is a NEW valid recipe + before→after preview', async () => {
    const tools = buildWriteTools(deps)
    const p = (await toolByName(tools, 'propose_scale_recipe').run({
      recipeId: RECIPE_ID,
      targetBatchSize_L: 38,
    })) as Proposal
    expect(p.kind).toBe('proposal')
    expect(p.action.type).toBe('scale_recipe')
    if (p.action.type !== 'scale_recipe') throw new Error('type')
    expect(p.action.payload.id).not.toBe(RECIPE_ID) // fresh id
    expect(p.action.payload.name).toBe('SMaSH Pale (scaled)')
    expect(p.action.payload.batchSize_L).toBe(38)
    expect(p.action.preview.before.batchSize_L).toBe(19)
    expect(p.action.preview.after.batchSize_L).toBe(38)
    // Linear batch-size scale keeps OG ~constant.
    expect(p.action.preview.after.OG).toBeCloseTo(p.action.preview.before.OG, 3)
  })

  it('propose_scale_recipe (target OG) → after.OG matches the requested target', async () => {
    const tools = buildWriteTools(deps)
    const p = (await toolByName(tools, 'propose_scale_recipe').run({
      recipeId: RECIPE_ID,
      targetOG: 1.06,
    })) as Proposal
    if (p.action.type !== 'scale_recipe') throw new Error('type')
    expect(p.action.preview.after.OG).toBeCloseTo(1.06, 3)
  })

  it('propose_scale_recipe rejects giving both / neither of batch size & OG', async () => {
    const tools = buildWriteTools(deps)
    await expect(
      toolByName(tools, 'propose_scale_recipe').run({ recipeId: RECIPE_ID }),
    ).rejects.toThrow()
    await expect(
      toolByName(tools, 'propose_scale_recipe').run({
        recipeId: RECIPE_ID,
        targetBatchSize_L: 38,
        targetOG: 1.06,
      }),
    ).rejects.toThrow()
  })

  it('propose_scale_recipe throws when the recipe is unknown', async () => {
    const tools = buildWriteTools(fakeReadDeps())
    await expect(
      toolByName(tools, 'propose_scale_recipe').run({
        recipeId: MISSING_ID,
        targetBatchSize_L: 38,
      }),
    ).rejects.toThrow(/not found/i)
  })

  it('propose_log_reading → payload reading + "add SG … to <batch>" preview', async () => {
    const tools = buildWriteTools(deps)
    const p = (await toolByName(tools, 'propose_log_reading').run({
      batchId: BATCH_ID,
      gravity: 1.03,
      tempC: 19,
    })) as Proposal
    if (p.action.type !== 'log_reading') throw new Error('type')
    expect(p.action.payload.batchId).toBe(BATCH_ID)
    expect(p.action.payload.gravity).toBe(1.03)
    expect(p.action.payload.tempC).toBe(19)
    expect(p.action.payload.at).toBe(NOW_ISO) // injected clock
    expect(p.action.preview).toContain('SG 1.03')
    expect(p.action.preview).toContain('SMaSH #1')
  })

  it('propose_log_reading throws when the batch is unknown', async () => {
    const tools = buildWriteTools(fakeReadDeps())
    await expect(
      toolByName(tools, 'propose_log_reading').run({ batchId: BATCH_ID, gravity: 1.03 }),
    ).rejects.toThrow(/not found/i)
  })

  it('propose_adjust_inventory (delta) → signed delta payload + old→new preview', async () => {
    const tools = buildWriteTools(deps)
    const p = (await toolByName(tools, 'propose_adjust_inventory').run({
      inventoryItemId: INV_ID,
      delta: -20,
    })) as Proposal
    if (p.action.type !== 'adjust_inventory') throw new Error('type')
    expect(p.action.payload.delta).toBe(-20)
    expect(p.action.payload.reason).toBe('manual-adjust') // default
    expect(p.action.preview).toBe('Cascade: 50 → 30 g')
  })

  it('propose_adjust_inventory (newAmount) → delta = target − current', async () => {
    const tools = buildWriteTools(deps)
    const p = (await toolByName(tools, 'propose_adjust_inventory').run({
      inventoryItemId: INV_ID,
      newAmount: 40,
      reason: 'restock',
    })) as Proposal
    if (p.action.type !== 'adjust_inventory') throw new Error('type')
    expect(p.action.payload.delta).toBe(-10)
    expect(p.action.payload.reason).toBe('restock')
    expect(p.action.preview).toBe('Cascade: 50 → 40 g')
  })

  it('propose_adjust_inventory clamps the PREVIEW at 0 (never negative stock)', async () => {
    const tools = buildWriteTools(deps)
    const p = (await toolByName(tools, 'propose_adjust_inventory').run({
      inventoryItemId: INV_ID,
      delta: -999,
    })) as Proposal
    if (p.action.type !== 'adjust_inventory') throw new Error('type')
    expect(p.action.preview).toBe('Cascade: 50 → 0 g')
  })
})

describe('SAFETY INVARIANT: propose tools write NOTHING (real Dexie counts)', () => {
  let db: BrewDB
  let deps: ToolDeps

  beforeEach(async () => {
    db = new BrewDB('ai-actions-propose-noop')
    await db.open()
    await makeEquipmentRepo(db).save(B40PRO_PROFILE)
    await makeRecipeRepo(db).save(recipe)
    await makeInventoryRepo(db).save(invItem)
    await makeBatchRepo(db).save(batch)
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
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('ai-actions-propose-noop')
  })

  async function snapshot() {
    return {
      recipes: await db.recipes.count(),
      readings: await db.readings.count(),
      inventory: await db.inventoryItems.count(),
      stock: await db.stockTransactions.count(),
      itemAmount: (await makeInventoryRepo(db).get(INV_ID))?.amount,
    }
  }

  it('every propose tool leaves the DB byte-for-byte unchanged (counts + item amount)', async () => {
    const tools = buildWriteTools(deps)
    const before = await snapshot()

    await toolByName(tools, 'propose_scale_recipe').run({
      recipeId: RECIPE_ID,
      targetBatchSize_L: 38,
    })
    await toolByName(tools, 'propose_create_recipe').run({ draft: recipe })
    await toolByName(tools, 'propose_log_reading').run({ batchId: BATCH_ID, gravity: 1.03 })
    await toolByName(tools, 'propose_adjust_inventory').run({ inventoryItemId: INV_ID, delta: -20 })

    const after = await snapshot()
    expect(after).toEqual(before)
    // Nothing was appended to any store.
    expect(after.recipes).toBe(1)
    expect(after.readings).toBe(0)
    expect(after.stock).toBe(0)
    expect(after.itemAmount).toBe(50)
  })
})

describe('applyAction: the ONLY write path (real Dexie, atomic repos)', () => {
  let db: BrewDB
  let readDeps: ToolDeps
  let writeDeps: ActionWriteDeps

  beforeEach(async () => {
    db = new BrewDB('ai-actions-apply')
    await db.open()
    await makeEquipmentRepo(db).save(B40PRO_PROFILE)
    await makeRecipeRepo(db).save(recipe)
    await makeInventoryRepo(db).save(invItem)
    await makeBatchRepo(db).save(batch)
    readDeps = {
      recipes: makeRecipeRepo(db),
      inventory: makeInventoryRepo(db),
      gear: makeGearRepo(db),
      batches: makeBatchRepo(db),
      readings: makeReadingsRepo(db),
      water: makeWaterRepo(db),
      equipment: makeEquipmentRepo(db),
      now: () => NOW,
    }
    writeDeps = {
      recipes: makeRecipeRepo(db),
      readings: makeReadingsRepo(db),
      stock: makeStockTransactionsRepo(db),
    }
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('ai-actions-apply')
  })

  it('scale_recipe propose→apply saves the NEW recipe EXACTLY as previewed', async () => {
    const tools = buildWriteTools(readDeps)
    const p = (await toolByName(tools, 'propose_scale_recipe').run({
      recipeId: RECIPE_ID,
      targetBatchSize_L: 38,
    })) as Proposal
    if (p.action.type !== 'scale_recipe') throw new Error('type')

    const res = await applyAction(p.action, writeDeps)
    expect(res.ok).toBe(true)
    if (!res.ok || res.result.kind !== 'recipe') throw new Error('bad result')

    // A brand-new row landed (original untouched).
    expect(await db.recipes.count()).toBe(2)
    const saved = await makeRecipeRepo(db).get(res.result.recipe.id)
    expect(saved?.batchSize_L).toBe(38)
    expect(saved?.name).toBe('SMaSH Pale (scaled)')
    expect(saved?.id).not.toBe(RECIPE_ID)
    // The saved recipe computes to EXACTLY the previewed after-OG.
    const og =
      Math.round(calculateRecipe(saved as Recipe, B40PRO_PROFILE, NOW_ISO).OG * 1000) / 1000
    expect(og).toBe(p.action.preview.after.OG)
  })

  it('create_recipe apply saves a fresh recipe row', async () => {
    const tools = buildWriteTools(readDeps)
    const p = (await toolByName(tools, 'propose_create_recipe').run({ draft: recipe })) as Proposal
    if (p.action.type !== 'create_recipe') throw new Error('type')
    const res = await applyAction(p.action, writeDeps)
    expect(res.ok).toBe(true)
    expect(await db.recipes.count()).toBe(2)
  })

  it('log_reading propose→apply adds the reading EXACTLY as previewed', async () => {
    const tools = buildWriteTools(readDeps)
    const p = (await toolByName(tools, 'propose_log_reading').run({
      batchId: BATCH_ID,
      gravity: 1.03,
      tempC: 19,
    })) as Proposal
    if (p.action.type !== 'log_reading') throw new Error('type')

    const res = await applyAction(p.action, writeDeps)
    expect(res.ok).toBe(true)
    const rows = await makeReadingsRepo(db).listByBatch(BATCH_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.gravity).toBe(1.03)
    expect(rows[0]?.tempC).toBe(19)
    expect(rows[0]?.batchId).toBe(BATCH_ID)
  })

  it('adjust_inventory propose→apply moves stock via the ledger EXACTLY as previewed', async () => {
    const tools = buildWriteTools(readDeps)
    const p = (await toolByName(tools, 'propose_adjust_inventory').run({
      inventoryItemId: INV_ID,
      delta: -20,
    })) as Proposal
    if (p.action.type !== 'adjust_inventory') throw new Error('type')
    expect(p.action.preview).toBe('Cascade: 50 → 30 g')

    const res = await applyAction(p.action, writeDeps)
    expect(res.ok).toBe(true)
    if (!res.ok || res.result.kind !== 'inventory') throw new Error('bad result')
    expect(res.result.newAmount).toBe(30)

    // Atomic: item amount AND a matching ledger row both land.
    expect((await makeInventoryRepo(db).get(INV_ID))?.amount).toBe(30)
    const ledger = await makeStockTransactionsRepo(db).listByItem(INV_ID)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.delta).toBe(-20)
    expect(ledger[0]?.reason).toBe('manual-adjust')
  })

  it('re-validates the payload: a bad payload returns {ok:false} and writes NOTHING', async () => {
    const badReading: ActionDescriptor = {
      type: 'log_reading',
      title: 'x',
      preview: 'x',
      // gravity must be a number — this is a poisoned stored proposal.
      payload: {
        id: MISSING_ID,
        batchId: BATCH_ID,
        at: NOW_ISO,
        gravity: 'nope',
        schemaVersion: 1,
      },
    } as unknown as ActionDescriptor

    const res = await applyAction(badReading, writeDeps)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('should have failed')
    expect(res.error).toBeTruthy()
    // No reading written.
    expect(await db.readings.count()).toBe(0)
  })

  it('adjust_inventory on a missing item throws inside the repo → {ok:false}, no ledger row', async () => {
    const action: ActionDescriptor = {
      type: 'adjust_inventory',
      title: 'x',
      preview: 'x',
      payload: { inventoryItemId: MISSING_ID, delta: -5, reason: 'manual-adjust' },
    }
    const res = await applyAction(action, writeDeps)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('should have failed')
    expect(res.error).toMatch(/not found/i)
    expect(await db.stockTransactions.count()).toBe(0)
    // The unrelated real item is untouched.
    expect((await makeInventoryRepo(db).get(INV_ID))?.amount).toBe(50)
  })
})
