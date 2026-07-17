/**
 * Terminal/MCP Stage A — the Node dependency adapters over a file-backed brewery.
 *
 * Provides Node implementations of the SAME interfaces the browser tools use:
 *   - {@link ToolDeps}        (read paths)  → `createFileToolDeps`
 *   - {@link ActionWriteDeps} (write paths) → `createFileWriteDeps`
 *
 * Both are backed by an in-memory {@link BreweryStore} loaded from an exported
 * brewery JSON file (see `brewery-store.ts`) instead of Dexie. Because they
 * satisfy the interfaces EXACTLY, Stage B (the MCP server) can wire the existing
 * engine unchanged:
 *
 *     const { toolDeps, writeDeps } = await openBrewery(path)
 *     const tools = buildAllTools(toolDeps)         // from '@/lib/ai/tools'
 *     const res   = await applyAction(action, writeDeps) // from '@/lib/ai/actions/apply'
 *
 * The write deps replicate the Dexie repos' ATOMIC semantics: recipe/reading saves
 * are single validated upserts; `applyStockChange` clamps the balance at 0, records
 * the EFFECTIVE delta, and keeps the ledger invariant `amount === Σ deltas`. Every
 * write is flushed to the file with an atomic temp+rename before the in-memory
 * store advances, so file and memory never diverge and a failed write corrupts
 * neither.
 *
 * NODE-ONLY: the type-only imports of `ToolDeps` / `ActionWriteDeps` /
 * `ApplyStockChangeInput` are erased at compile time, so NONE of the Dexie-backed
 * singletons they live next to are pulled into this module's runtime.
 */

import type { ActionWriteDeps } from '@/lib/ai/actions/apply'
import type { ToolDeps } from '@/lib/ai/tools/deps'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { type Reading, ReadingSchema } from '@/lib/brewing/types/reading'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'
import {
  buildStockTransaction,
  StockTransactionSchema,
} from '@/lib/brewing/types/stock-transaction'
import type { ApplyStockChangeInput } from '@/lib/db/repos/stock-transactions'
import { type BreweryCollections, loadBrewery, saveBrewery } from '@/lib/node/brewery-store'
import { newId } from '@/lib/utils/id'

// ── sort helpers (replicate the Dexie repos' ordering) ──────────────────────
const byUpdatedAtDesc = <T extends { updatedAt: string }>(a: T, b: T): number =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
const byNameAsc = <T extends { name: string }>(a: T, b: T): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0
const byAtAsc = <T extends { at: string }>(a: T, b: T): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : 0

/** Shallow-clone every collection (new array refs, shared immutable elements). */
function cloneCollections(d: BreweryCollections): BreweryCollections {
  return {
    recipes: [...d.recipes],
    equipmentProfiles: [...d.equipmentProfiles],
    ingredients: [...d.ingredients],
    settings: [...d.settings],
    inventoryItems: [...d.inventoryItems],
    gearItems: [...d.gearItems],
    waterProfiles: [...d.waterProfiles],
    batches: [...d.batches],
    brewSessions: [...d.brewSessions],
    brewTimers: [...d.brewTimers],
    readings: [...d.readings],
    stockTransactions: [...d.stockTransactions],
    seedTombstones: [...d.seedTombstones],
    yeastLots: [...d.yeastLots],
    rowTombstones: [...d.rowTombstones],
  }
}

/**
 * A file-backed, in-memory brewery with transactional writes. `data` is the live
 * source of truth reads see; `commit()` applies a mutation to a CLONE, persists
 * atomically, and only swaps `data` in once the durable write succeeds — so a
 * failed flush leaves both the file and `data` at their prior consistent state.
 */
export class BreweryStore {
  private constructor(
    readonly filePath: string,
    public data: BreweryCollections,
    readonly now: () => Date,
  ) {}

  static async load(filePath: string, now: () => Date = () => new Date()): Promise<BreweryStore> {
    const data = await loadBrewery(filePath)
    return new BreweryStore(filePath, data, now)
  }

  /** Re-read the file from disk, replacing the in-memory collections. */
  async reload(): Promise<void> {
    this.data = await loadBrewery(this.filePath)
  }

  /** Persist the current in-memory collections atomically (temp + rename). */
  async flush(): Promise<void> {
    await saveBrewery(this.filePath, this.data, this.now().toISOString())
  }

  /**
   * Run `mutate` against a clone, persist the result atomically, then swap it in.
   * If `mutate` throws (bad payload, item-not-found) or the write fails, `data` is
   * left untouched. Returns whatever `mutate` returns.
   */
  async commit<T>(mutate: (draft: BreweryCollections) => T): Promise<T> {
    const draft = cloneCollections(this.data)
    const result = mutate(draft)
    await saveBrewery(this.filePath, draft, this.now().toISOString())
    this.data = draft
    return result
  }
}

/** Upsert `row` by `id` into `arr` (replace in place or append). */
function upsertById<T extends { id: string }>(arr: T[], row: T): void {
  const i = arr.findIndex((x) => x.id === row.id)
  if (i >= 0) arr[i] = row
  else arr.push(row)
}

/**
 * Read-only {@link ToolDeps} over the store. Each reader returns freshly
 * Zod-parsed rows in the same order the Dexie repos use, so `buildAllTools` sees
 * exactly the shapes it would in the browser.
 */
export function createFileToolDeps(store: BreweryStore): ToolDeps {
  return {
    recipes: {
      list: async () =>
        [...store.data.recipes].sort(byUpdatedAtDesc).map((r) => RecipeSchema.parse(r)),
      get: async (id) => {
        const row = store.data.recipes.find((r) => r.id === id)
        return row ? RecipeSchema.parse(row) : null
      },
    },
    inventory: {
      list: async () =>
        [...store.data.inventoryItems]
          .sort(byUpdatedAtDesc)
          .map((r) => InventoryItemSchema.parse(r)),
    },
    gear: {
      list: async () => [...store.data.gearItems].sort(byUpdatedAtDesc),
    },
    batches: {
      list: async () => [...store.data.batches].sort(byUpdatedAtDesc),
      get: async (id) => store.data.batches.find((b) => b.id === id) ?? null,
    },
    readings: {
      listByBatch: async (batchId) =>
        store.data.readings
          .filter((r) => r.batchId === batchId)
          .sort(byAtAsc)
          .map((r) => ReadingSchema.parse(r)),
    },
    water: {
      list: async () => [...store.data.waterProfiles].sort(byNameAsc),
      get: async (id) => store.data.waterProfiles.find((w) => w.id === id) ?? null,
    },
    equipment: {
      list: async () => [...store.data.equipmentProfiles].sort(byNameAsc),
      get: async (id) => store.data.equipmentProfiles.find((e) => e.id === id) ?? null,
      getDefault: async () =>
        store.data.equipmentProfiles.find((e) => e.isDefault === true) ?? null,
    },
    now: store.now,
  }
}

/**
 * Write-capable {@link ActionWriteDeps} over the store — the Node twin of the
 * Dexie repos `applyAction` commits through. Each method validates, mutates the
 * in-memory store, and flushes to the file atomically.
 */
export function createFileWriteDeps(store: BreweryStore): ActionWriteDeps {
  return {
    recipes: {
      // Mirrors recipeRepo.save: stamp updatedAt, Zod-parse, upsert.
      save: async (r: Recipe) =>
        store.commit((d) => {
          const stamped = { ...r, updatedAt: store.now().toISOString() }
          const validated = RecipeSchema.parse(stamped)
          upsertById(d.recipes, validated)
          return validated
        }),
    },
    readings: {
      // Mirrors readingsRepo.create: Zod-parse, put (upsert by id).
      create: async (r: Reading) =>
        store.commit((d) => {
          const validated = ReadingSchema.parse(r)
          upsertById(d.readings, validated)
          return validated
        }),
    },
    stock: {
      /**
       * Faithful Node port of `stockTransactionsRepo.applyStockChange`: in one
       * transactional commit, clamp the new balance at 0, record the EFFECTIVE
       * delta (`newAmount - oldAmount`) as a ledger row, and update the item's
       * cached amount — so `amount === Σ deltas` holds even when a deduct would
       * have driven the balance negative. Returns the new balance.
       */
      applyStockChange: async (input: ApplyStockChangeInput) => {
        const at = input.at ?? store.now().toISOString()
        return store.commit((d) => {
          const idx = d.inventoryItems.findIndex((x) => x.id === input.inventoryItemId)
          if (idx < 0) {
            throw new Error(`applyStockChange: inventory item not found (${input.inventoryItemId})`)
          }
          const item = InventoryItemSchema.parse(d.inventoryItems[idx])
          const newAmount = Math.max(0, item.amount + input.delta)
          const effectiveDelta = newAmount - item.amount
          const txn = StockTransactionSchema.parse(
            buildStockTransaction({
              id: newId(),
              item,
              delta: effectiveDelta,
              reason: input.reason,
              at,
              note: input.note,
              batchId: input.batchId,
              recipeUseRef: input.recipeUseRef,
            }),
          )
          const updated = InventoryItemSchema.parse({ ...item, amount: newAmount, updatedAt: at })
          d.stockTransactions.push(txn)
          d.inventoryItems[idx] = updated
          return newAmount
        })
      },
    },
  }
}

/** The bundle Stage B wires the engine over. */
export interface BreweryAdapter {
  store: BreweryStore
  toolDeps: ToolDeps
  writeDeps: ActionWriteDeps
  /** Re-read the file from disk into memory. */
  reload: () => Promise<void>
  /** Persist the current in-memory state atomically. */
  flush: () => Promise<void>
}

/**
 * Open a brewery export file and return the wired adapter. `buildAllTools(toolDeps)`
 * + `applyAction(action, writeDeps)` then run entirely over the file, no browser.
 *
 * @param filePath path to an exported brewery JSON (a v1..v6 dump envelope).
 * @param opts.now injectable clock (defaults to the wall clock) — deterministic in tests.
 */
export async function openBrewery(
  filePath: string,
  opts: { now?: () => Date } = {},
): Promise<BreweryAdapter> {
  const store = await BreweryStore.load(filePath, opts.now ?? (() => new Date()))
  return {
    store,
    toolDeps: createFileToolDeps(store),
    writeDeps: createFileWriteDeps(store),
    reload: () => store.reload(),
    flush: () => store.flush(),
  }
}
