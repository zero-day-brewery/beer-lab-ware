import Dexie from 'dexie'
import { type InventoryItem, InventoryItemSchema } from '@/lib/brewing/types/inventory'
import {
  buildStockTransaction,
  type RecipeUseRef,
  type StockReason,
  type StockTransaction,
  StockTransactionSchema,
} from '@/lib/brewing/types/stock-transaction'
import { type BrewDB, db } from '@/lib/db/schema'
import { newId } from '@/lib/utils/id'

export interface ApplyStockChangeInput {
  inventoryItemId: string
  delta: number
  reason: StockReason
  note?: string
  /** ISO timestamp; defaults to now. */
  at?: string
  /** 2b: the batch this movement belongs to (set on `brew-deduct`). */
  batchId?: string
  /** 2b: provenance back to the recipe line that consumed the stock. */
  recipeUseRef?: RecipeUseRef
}

export function makeStockTransactionsRepo(database: BrewDB) {
  return {
    /**
     * All txns for one item, chronological (oldest → newest) via the
     * `[inventoryItemId+at]` compound index. Zod-parsed on read.
     */
    async listByItem(inventoryItemId: string): Promise<StockTransaction[]> {
      const rows = await database.stockTransactions
        .where('[inventoryItemId+at]')
        .between([inventoryItemId, Dexie.minKey], [inventoryItemId, Dexie.maxKey])
        .toArray()
      return rows.map((r) => StockTransactionSchema.parse(r))
    },

    /**
     * All txns for one batch (via the `batchId` index), Zod-parsed. Powers the
     * 2b double-deduct guard + the "already deducted" read-only view.
     */
    async listByBatch(batchId: string): Promise<StockTransaction[]> {
      const rows = await database.stockTransactions.where('batchId').equals(batchId).toArray()
      return rows.map((r) => StockTransactionSchema.parse(r))
    },

    /** Zod-parse + put a fully-formed txn (used for wiring/imports/backfill). */
    async append(txn: StockTransaction): Promise<StockTransaction> {
      const validated = StockTransactionSchema.parse(txn)
      await database.stockTransactions.put(validated)
      return validated
    },

    /**
     * ATOMIC new-item / edit-amount write: in ONE read-write transaction over
     * both stores, Zod-parse + `put` the item AND (when a `txn` is supplied)
     * Zod-parse + `put` the matching ledger row. Either both land or neither
     * does — so `amount === Σ deltas` can never be left transiently broken by a
     * partial failure between the two writes. Pass `txn = null` for a non-amount
     * edit (item saved, no ledger row). Mirrors `applyStockChange`'s tx shape;
     * the caller owns the item's `updatedAt` stamp + the txn's `id`/`at`.
     */
    async saveItemWithTxn(item: InventoryItem, txn: StockTransaction | null): Promise<void> {
      await database.transaction(
        'rw',
        database.stockTransactions,
        database.inventoryItems,
        async () => {
          const validatedItem = InventoryItemSchema.parse(item)
          await database.inventoryItems.put(validatedItem)
          if (txn) {
            const validatedTxn = StockTransactionSchema.parse(txn)
            await database.stockTransactions.put(validatedTxn)
          }
        },
      )
    },

    /**
     * The ATOMIC primitive: in ONE read-write transaction over both stores,
     * write the ledger txn AND update the item's cached `amount` together, both
     * Zod-parsed. Amount is clamped at 0 (never negative); the txn records the
     * EFFECTIVE delta (`newAmount - oldAmount`) so `amount === Σ deltas` holds
     * even when a deduct would have gone below zero. Returns the new balance.
     */
    async applyStockChange(input: ApplyStockChangeInput): Promise<number> {
      const at = input.at ?? new Date().toISOString()
      return database.transaction(
        'rw',
        database.stockTransactions,
        database.inventoryItems,
        async () => {
          const raw = await database.inventoryItems.get(input.inventoryItemId)
          if (!raw) {
            throw new Error(`applyStockChange: inventory item not found (${input.inventoryItemId})`)
          }
          const item = InventoryItemSchema.parse(raw)
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
          await database.stockTransactions.put(txn)
          await database.inventoryItems.put(updated)
          return newAmount
        },
      )
    },

    /**
     * ATOMIC batch-deduct primitive (2b): apply MANY stock changes in ONE
     * read-write transaction, all-or-nothing. First asserts the per-batch
     * idempotency guard INSIDE the tx — if any `brew-deduct` txn already exists
     * for `batchId`, it throws and nothing is written (closes the TOCTOU window
     * the per-line loop had). Then, for each change, it runs the same
     * read-modify-write as `applyStockChange` (clamp at 0, record the EFFECTIVE
     * delta, `put` txn + item). A throw on ANY change (missing item, bad Zod)
     * rolls back every write in the batch — no partial deduction can survive.
     */
    async applyStockChanges(
      changes: readonly ApplyStockChangeInput[],
      opts: { batchId: string },
    ): Promise<void> {
      await database.transaction(
        'rw',
        database.stockTransactions,
        database.inventoryItems,
        async () => {
          // Idempotency guard inside the tx: refuse if this batch is already deducted.
          const existing = await database.stockTransactions
            .where('batchId')
            .equals(opts.batchId)
            .toArray()
          if (existing.some((t) => t.reason === 'brew-deduct')) {
            throw new Error(`applyStockChanges: batch already deducted (${opts.batchId})`)
          }
          for (const input of changes) {
            const at = input.at ?? new Date().toISOString()
            const raw = await database.inventoryItems.get(input.inventoryItemId)
            if (!raw) {
              throw new Error(
                `applyStockChanges: inventory item not found (${input.inventoryItemId})`,
              )
            }
            const item = InventoryItemSchema.parse(raw)
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
            await database.stockTransactions.put(txn)
            await database.inventoryItems.put(updated)
          }
        },
      )
    },

    /** Cascade delete every txn for an item (called when the item is deleted). */
    async deleteByItem(inventoryItemId: string): Promise<void> {
      await database.stockTransactions.where('inventoryItemId').equals(inventoryItemId).delete()
    },
  }
}

export const stockTransactionsRepo = makeStockTransactionsRepo(db)
