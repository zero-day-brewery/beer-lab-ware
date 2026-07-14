/**
 * Terminal/MCP Stage A — Node, file-backed brewery adapter tests (no browser).
 *
 * Proves the Node ToolDeps/ActionWriteDeps run the EXISTING engine over an
 * exported brewery JSON file: a fixture export loads → the tools read the right
 * data; `buildAllTools(toolDeps)` yields a working registry; `applyAction` for
 * scale_recipe / log_reading / adjust_inventory updates the in-memory store AND
 * the file (a fresh `loadBrewery` reflects it); the inventory ledger invariant
 * (`amount === Σ deltas`, clamp at 0) holds; and a malformed/failed save never
 * corrupts the existing file.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyAction } from '@/lib/ai/actions/apply'
import type { ActionDescriptor } from '@/lib/ai/actions/types'
import { buildAllTools, buildTools } from '@/lib/ai/tools'
import type { AiTool } from '@/lib/ai/types'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE, B40PRO_PROFILE_ID } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Water } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import {
  atomicWriteJson,
  type BreweryCollections,
  type BreweryFile,
  emptyCollections,
  loadBrewery,
  openBrewery,
} from '@/lib/node'

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
const OPENING_TXN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SCALED_RECIPE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW_READING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

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

// v7-style opening txn so `amount === Σ deltas` holds from the fixture's day one.
const openingTxn: StockTransaction = {
  id: OPENING_TXN_ID,
  inventoryItemId: INV_ID,
  kind: 'hop',
  delta: 50,
  unit: 'g',
  reason: 'opening',
  at: '2026-06-01T00:00:00.000Z',
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

function fixtureCollections(): BreweryCollections {
  return {
    ...emptyCollections(),
    recipes: [recipe],
    equipmentProfiles: [B40PRO_PROFILE],
    inventoryItems: [invItem],
    waterProfiles: [water],
    batches: [batch],
    readings: [...readings],
    stockTransactions: [openingTxn],
  }
}

/** A real export envelope (v8 dump), written to disk with plain fs (not saveBrewery). */
function fixtureEnvelope(): BreweryFile {
  return {
    version: 8,
    exportedAt: NOW_ISO,
    meta: { dumpVersion: 8, dbVersion: 8, rowCounts: {}, schemaVersion: 1 },
    tables: fixtureCollections(),
  }
}

function toolByName(tools: AiTool[], name: string): AiTool {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return t
}

/** Σ of every ledger delta for one item — must equal the item's cached amount. */
function ledgerSum(txns: StockTransaction[], itemId: string): number {
  return txns.filter((t) => t.inventoryItemId === itemId).reduce((s, t) => s + t.delta, 0)
}

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brewery-adapter-'))
  file = path.join(dir, 'brewery.json')
  // Write the fixture with RAW fs — proves loadBrewery parses an externally-produced export.
  await fs.writeFile(file, JSON.stringify(fixtureEnvelope(), null, 2), 'utf8')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Node file-backed adapter — reads (ToolDeps)', () => {
  it('loads a fixture export and the read tools return the right data', async () => {
    const { toolDeps } = await openBrewery(file, { now: () => NOW })
    const tools = buildTools(toolDeps)

    const recipes = (await toolByName(tools, 'list_recipes').run({})) as Array<{
      id: string
      name: string
      hopCount: number
    }>
    expect(recipes).toHaveLength(1)
    expect(recipes[0]).toMatchObject({ id: RECIPE_ID, name: 'SMaSH Pale', hopCount: 1 })

    const got = (await toolByName(tools, 'get_recipe').run({ id: RECIPE_ID })) as {
      computed: { OG: number; ABV: number } | null
      computedWith: string | null
    }
    expect(got.computed?.OG).toBeGreaterThan(1)
    expect(got.computed?.ABV).toBeGreaterThan(0)
    expect(got.computedWith).toBe(B40PRO_PROFILE.name)

    const inv = (await toolByName(tools, 'list_inventory').run({})) as Array<{
      name: string
      lowStock: boolean
    }>
    expect(inv[0]).toMatchObject({ name: 'Cascade', lowStock: true })

    const batches = (await toolByName(tools, 'list_batches').run({})) as Array<{ batchNo: number }>
    expect(batches[0]?.batchNo).toBe(1)

    const gotBatch = (await toolByName(tools, 'get_batch').run({ id: BATCH_ID })) as {
      readingCount: number
    }
    expect(gotBatch.readingCount).toBe(2)

    const wp = (await toolByName(tools, 'list_water_profiles').run({})) as Array<{ name: string }>
    expect(wp[0]?.name).toBe('RO')

    const equip = (await toolByName(tools, 'list_equipment').run({})) as Array<{
      isDefault: boolean
    }>
    expect(equip[0]?.isDefault).toBe(true)
  })

  it('buildAllTools(toolDeps) yields a working registry (reads + propose write tools)', async () => {
    const { toolDeps } = await openBrewery(file, { now: () => NOW })
    const tools = buildAllTools(toolDeps)
    const names = tools.map((t) => t.name)
    // 11 read tools + 4 propose tools, all with a JSON input schema.
    expect(tools).toHaveLength(15)
    expect(names).toContain('list_recipes')
    expect(names).toContain('propose_scale_recipe')
    expect(names).toContain('propose_adjust_inventory')
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: 'object' })
    // A read tool actually returns real data through the registry.
    const out = (await toolByName(tools, 'list_recipes').run({})) as unknown[]
    expect(out).toHaveLength(1)
  })
})

describe('Node file-backed adapter — writes (applyAction over ActionWriteDeps)', () => {
  it('scale_recipe → in-memory + FILE updated; a fresh loadBrewery reflects it', async () => {
    const { toolDeps, writeDeps } = await openBrewery(file, { now: () => NOW })
    const scaled: Recipe = {
      ...recipe,
      id: SCALED_RECIPE_ID,
      name: 'SMaSH Pale (x2)',
      batchSize_L: 38,
    }
    const action: ActionDescriptor = {
      type: 'scale_recipe',
      title: 'Scale SMaSH Pale',
      preview: {
        recipeName: scaled.name,
        before: { batchSize_L: 19, OG: 1.05 },
        after: { batchSize_L: 38, OG: 1.05 },
      },
      payload: scaled,
    }
    const res = await applyAction(action, writeDeps)
    expect(res.ok).toBe(true)

    // in-memory (via the same toolDeps) now lists both recipes
    const listed = (await toolByName(buildTools(toolDeps), 'list_recipes').run({})) as Array<{
      id: string
    }>
    expect(listed.map((r) => r.id).sort()).toEqual([RECIPE_ID, SCALED_RECIPE_ID].sort())

    // FILE: a fresh, independent load sees the new recipe persisted
    const reloaded = await loadBrewery(file)
    expect(reloaded.recipes.some((r) => r.id === SCALED_RECIPE_ID)).toBe(true)
    expect(reloaded.recipes.find((r) => r.id === SCALED_RECIPE_ID)?.batchSize_L).toBe(38)
  })

  it('log_reading → readings updated in memory + file; listByBatch reflects it', async () => {
    const { toolDeps, writeDeps } = await openBrewery(file, { now: () => NOW })
    const reading: Reading = {
      id: NEW_READING_ID,
      batchId: BATCH_ID,
      at: '2026-07-02T00:00:00.000Z',
      gravity: 1.008,
      tempC: 20,
      schemaVersion: 1,
    }
    const action: ActionDescriptor = {
      type: 'log_reading',
      title: 'Log reading',
      preview: 'SG 1.008 @ 20°C',
      payload: reading,
    }
    const res = await applyAction(action, writeDeps)
    expect(res.ok).toBe(true)

    const listed = await toolDeps.readings.listByBatch(BATCH_ID)
    expect(listed).toHaveLength(3)
    expect(listed.some((r) => r.id === NEW_READING_ID)).toBe(true)

    const reloaded = await loadBrewery(file)
    expect(reloaded.readings.some((r) => r.id === NEW_READING_ID)).toBe(true)
  })

  it('adjust_inventory → clamps at 0, records effective delta, keeps amount === Σ deltas', async () => {
    const { writeDeps, store } = await openBrewery(file, { now: () => NOW })

    // Deduct 80 from 50 → clamps to 0; effective delta recorded is -50.
    const deduct: ActionDescriptor = {
      type: 'adjust_inventory',
      title: 'Use Cascade',
      preview: '-80 g Cascade',
      payload: { inventoryItemId: INV_ID, delta: -80, reason: 'brew-deduct' },
    }
    const r1 = await applyAction(deduct, writeDeps)
    expect(r1.ok).toBe(true)
    expect(r1.ok && r1.result.kind === 'inventory' && r1.result.newAmount).toBe(0)

    // ledger invariant after the clamp: Σ deltas (50 + -50) === amount (0)
    let item = store.data.inventoryItems.find((i) => i.id === INV_ID)
    expect(item?.amount).toBe(0)
    expect(ledgerSum(store.data.stockTransactions, INV_ID)).toBe(0)
    // the clamped txn recorded the EFFECTIVE delta, not the requested -80
    const deducted = store.data.stockTransactions.filter((t) => t.reason === 'brew-deduct')
    expect(deducted).toHaveLength(1)
    expect(deducted[0]?.delta).toBe(-50)

    // Restock +30 → amount 30; invariant still holds
    const restock: ActionDescriptor = {
      type: 'adjust_inventory',
      title: 'Restock Cascade',
      preview: '+30 g Cascade',
      payload: { inventoryItemId: INV_ID, delta: 30, reason: 'restock', note: 'new bag' },
    }
    const r2 = await applyAction(restock, writeDeps)
    expect(r2.ok && r2.result.kind === 'inventory' && r2.result.newAmount).toBe(30)
    item = store.data.inventoryItems.find((i) => i.id === INV_ID)
    expect(item?.amount).toBe(30)
    expect(ledgerSum(store.data.stockTransactions, INV_ID)).toBe(30)

    // FILE reflects the final state after a fresh load
    const reloaded = await loadBrewery(file)
    const reloadedItem = reloaded.inventoryItems.find((i) => i.id === INV_ID)
    expect(reloadedItem?.amount).toBe(30)
    expect(ledgerSum(reloaded.stockTransactions, INV_ID)).toBe(30)
    expect(reloadedItem?.amount).toBe(ledgerSum(reloaded.stockTransactions, INV_ID))
  })

  it('leaves no temp files behind after successful writes', async () => {
    const { writeDeps } = await openBrewery(file, { now: () => NOW })
    await applyAction(
      {
        type: 'adjust_inventory',
        title: 'x',
        preview: 'x',
        payload: { inventoryItemId: INV_ID, delta: -5, reason: 'manual-adjust' },
      },
      writeDeps,
    )
    const entries = await fs.readdir(dir)
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
    expect(entries).toContain('brewery.json')
  })
})

describe('Node file-backed adapter — failure safety', () => {
  it('an invalid recipe save throws and does NOT corrupt the existing file', async () => {
    const { writeDeps } = await openBrewery(file, { now: () => NOW })
    const before = await fs.readFile(file, 'utf8')
    // name '' violates RecipeSchema (min 1) → parse throws before any file write.
    const bad = { ...recipe, id: SCALED_RECIPE_ID, name: '' } as Recipe
    const res = await applyAction(
      { type: 'create_recipe', title: 'bad', preview: 'bad', payload: bad },
      writeDeps,
    )
    expect(res.ok).toBe(false)
    const after = await fs.readFile(file, 'utf8')
    expect(after).toBe(before)
    // and the file is still a valid, unchanged brewery
    const reloaded = await loadBrewery(file)
    expect(reloaded.recipes.map((r) => r.id)).toEqual([RECIPE_ID])
  })

  it('applyStockChange on an unknown item throws and does NOT corrupt the file', async () => {
    const { writeDeps } = await openBrewery(file, { now: () => NOW })
    const before = await fs.readFile(file, 'utf8')
    const res = await applyAction(
      {
        type: 'adjust_inventory',
        title: 'x',
        preview: 'x',
        payload: {
          inventoryItemId: '00000000-0000-4000-8000-000000000000',
          delta: -5,
          reason: 'restock',
        },
      },
      writeDeps,
    )
    expect(res.ok).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  it('atomicWriteJson: a non-serializable payload throws, preserving the file, no temp left', async () => {
    const before = await fs.readFile(file, 'utf8')
    // A circular structure is not JSON-serializable → JSON.stringify throws BEFORE any fs op.
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(atomicWriteJson(file, circular)).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe(before)
    const entries = await fs.readdir(dir)
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
  })

  it('loadBrewery rejects an unsupported version and malformed JSON', async () => {
    const badVersion = path.join(dir, 'v99.json')
    await fs.writeFile(badVersion, JSON.stringify({ version: 99, tables: {} }), 'utf8')
    await expect(loadBrewery(badVersion)).rejects.toThrow(/version/i)

    const badJson = path.join(dir, 'broken.json')
    await fs.writeFile(badJson, '{ not json', 'utf8')
    await expect(loadBrewery(badJson)).rejects.toThrow(/JSON/i)
  })
})
