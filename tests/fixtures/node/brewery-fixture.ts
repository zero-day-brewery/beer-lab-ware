/**
 * Shared fixture for the Node file-backed brewery + MCP server tests.
 *
 * Produces a real export envelope (v6 dump) with one recipe, the B40pro default
 * equipment profile, one inventory item (+ its opening ledger txn so
 * `amount === Σ deltas` holds), one water profile, one batch, and two readings —
 * written to disk with plain `fs` so the adapter/server parse an externally
 * produced file, exactly as a brewer's "Export backup JSON" would.
 */

import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE, B40PRO_PROFILE_ID } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Water } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { type BreweryCollections, type BreweryFile, emptyCollections } from '@/lib/node'

// ── valid v4 UUIDs (version nibble 4, variant nibble 8) ────────────────────
export const RECIPE_ID = '11111111-1111-4111-8111-111111111111'
export const FERM_ING = '44444444-4444-4444-8444-444444444444'
export const HOP_ING = '22222222-2222-4222-8222-222222222222'
export const YEAST_ING = '33333333-3333-4333-8333-333333333333'
export const INV_ID = '55555555-5555-4555-8555-555555555555'
export const WATER_ID = '66666666-6666-4666-8666-666666666666'
export const BATCH_ID = '77777777-7777-4777-8777-777777777777'
export const READ_ID1 = '88888888-8888-4888-8888-888888888888'
export const READ_ID2 = '99999999-9999-4999-8999-999999999999'
export const OPENING_TXN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

export const NOW = new Date('2026-07-05T12:00:00.000Z')
export const NOW_ISO = NOW.toISOString()

export const fixtureRecipe: Recipe = {
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

export const fixtureInvItem: InventoryItem = {
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

/** Opening txn so `amount === Σ deltas` holds from the fixture's day one. */
export const fixtureOpeningTxn: StockTransaction = {
  id: OPENING_TXN_ID,
  inventoryItemId: INV_ID,
  kind: 'hop',
  delta: 50,
  unit: 'g',
  reason: 'opening',
  at: '2026-06-01T00:00:00.000Z',
  schemaVersion: 1,
}

export const fixtureWater: Water = {
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

export const fixtureBatch: Batch = {
  id: BATCH_ID,
  batchNo: 1,
  name: 'SMaSH #1',
  status: 'complete',
  recipeId: RECIPE_ID,
  recipeSnapshot: fixtureRecipe,
  equipmentSnapshot: B40PRO_PROFILE,
  computedTargets: calculateRecipe(fixtureRecipe, B40PRO_PROFILE, NOW_ISO),
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

export const fixtureReadings: Reading[] = [
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

export function fixtureCollections(): BreweryCollections {
  return {
    ...emptyCollections(),
    recipes: [fixtureRecipe],
    equipmentProfiles: [B40PRO_PROFILE],
    inventoryItems: [fixtureInvItem],
    waterProfiles: [fixtureWater],
    batches: [fixtureBatch],
    readings: [...fixtureReadings],
    stockTransactions: [fixtureOpeningTxn],
  }
}

/** A real export envelope (v8 dump) — what gets written to disk in tests. */
export function fixtureEnvelope(): BreweryFile {
  return {
    version: 8,
    exportedAt: NOW_ISO,
    meta: { dumpVersion: 8, dbVersion: 8, rowCounts: {}, schemaVersion: 1 },
    tables: fixtureCollections(),
  }
}
