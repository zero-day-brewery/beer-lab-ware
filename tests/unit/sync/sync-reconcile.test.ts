/**
 * Reconciliation of a concurrent double-deduct that drives a merged ledger's
 * Σdeltas negative (see sync-client.ts module docs). Before the fix,
 * `reprojectAmounts` silently clamped `amount` to 0 without touching the
 * ledger, so `amount !== Σdeltas` and the server's `assertLedgerInvariant`
 * (brewery-store.ts) 400-rejected every subsequent push forever. The fix
 * appends a deterministic `sync-reconcile` compensating transaction instead.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { DumpV8 } from '@/lib/db/backup'
import { makeBackupService } from '@/lib/db/backup'
import { runDataDoctor } from '@/lib/db/doctor'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { BrewDB } from '@/lib/db/schema'
import { assertLedgerInvariant, emptyCollections } from '@/lib/node/brewery-store'
import { mergeDumpTables, syncOnce } from '@/lib/sync/sync-client'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-reconcile-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

const noopSnapshot = async () => {}

function item(over: Partial<InventoryItem> & { id: string }): InventoryItem {
  return {
    name: 'Cascade',
    ingredientKind: 'hop',
    amount: 100,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

async function sumDeltas(db: BrewDB, itemId: string): Promise<number> {
  const txns = await db.stockTransactions.where('inventoryItemId').equals(itemId).toArray()
  return txns.reduce((s, t) => s + t.delta, 0)
}

function emptyTables(): DumpV8['tables'] {
  return emptyCollections() as unknown as DumpV8['tables']
}

describe('sync reconciles a concurrent double-deduct instead of wedging forever', () => {
  it('brings merged amount back to amount === Σdeltas (never a silent clamp) and satisfies the server invariant', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()

    // Both devices start with the SAME item @ 100 (own opening txn ids — v7
    // migration mints per-device ids, deduped by dedupeOpenings).
    for (const db of [dbA, dbB]) {
      await db.inventoryItems.put(item({ id, amount: 100 }))
      await db.stockTransactions.put({
        id: crypto.randomUUID(),
        inventoryItemId: id,
        kind: 'hop',
        delta: 100,
        unit: 'g',
        reason: 'opening',
        at: '2026-05-01T00:00:00.000Z',
        schemaVersion: 1,
      })
    }

    // Each device deducts 60 — locally consistent alone (100-60=40 >= 0), but
    // the union double-deducts: 100-60-60 = -20. Neither device could have
    // known about the other's concurrent brew.
    await makeStockTransactionsRepo(dbA).applyStockChange({
      inventoryItemId: id,
      delta: -60,
      reason: 'brew-deduct',
    })
    await makeStockTransactionsRepo(dbB).applyStockChange({
      inventoryItemId: id,
      delta: -60,
      reason: 'brew-deduct',
    })

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    const mergedItem = await dbB.inventoryItems.get(id)
    expect(mergedItem).toBeDefined()
    const txns = await dbB.stockTransactions.where('inventoryItemId').equals(id).toArray()
    const sum = txns.reduce((s, t) => s + t.delta, 0)

    // The invariant holds EXACTLY — not a clamp that silently diverges from Σ.
    expect(mergedItem?.amount).toBe(sum)
    expect(mergedItem?.amount).toBe(0)
    expect(sum).toBe(0)

    const reconTxns = txns.filter((t) => t.reason === 'sync-reconcile')
    expect(reconTxns).toHaveLength(1)
    expect(reconTxns[0].delta).toBe(20) // compensates exactly the -20 shortfall
    expect(reconTxns[0].inventoryItemId).toBe(id)

    // The exact server-side gate (brewery-store.ts) must accept this dump —
    // this is what previously 400-rejected every push forever.
    const collections = {
      ...emptyCollections(),
      inventoryItems: mergedItem ? [mergedItem] : [],
      stockTransactions: txns,
    }
    expect(() => assertLedgerInvariant(collections)).not.toThrow()
  })

  it('produces zero C1 (ledger balance) errors from the data doctor after reconciliation', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()

    for (const db of [dbA, dbB]) {
      await db.inventoryItems.put(item({ id, amount: 50 }))
      await db.stockTransactions.put({
        id: crypto.randomUUID(),
        inventoryItemId: id,
        kind: 'hop',
        delta: 50,
        unit: 'g',
        reason: 'opening',
        at: '2026-05-01T00:00:00.000Z',
        schemaVersion: 1,
      })
    }
    await makeStockTransactionsRepo(dbA).applyStockChange({
      inventoryItemId: id,
      delta: -40,
      reason: 'brew-deduct',
    })
    await makeStockTransactionsRepo(dbB).applyStockChange({
      inventoryItemId: id,
      delta: -40,
      reason: 'brew-deduct',
    })

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    const report = await runDataDoctor(dbB, dbB.verno)
    const c1 = report.checks.find((c) => c.id === 'C1')
    expect(c1?.ok).toBe(true)
    expect(c1?.count).toBe(0)
  })

  it('converges: a third sync round does not re-reconcile (sum stays 0, one recon txn)', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()

    for (const db of [dbA, dbB]) {
      await db.inventoryItems.put(item({ id, amount: 100 }))
      await db.stockTransactions.put({
        id: crypto.randomUUID(),
        inventoryItemId: id,
        kind: 'hop',
        delta: 100,
        unit: 'g',
        reason: 'opening',
        at: '2026-05-01T00:00:00.000Z',
        schemaVersion: 1,
      })
    }
    await makeStockTransactionsRepo(dbA).applyStockChange({
      inventoryItemId: id,
      delta: -70,
      reason: 'brew-deduct',
    })
    await makeStockTransactionsRepo(dbB).applyStockChange({
      inventoryItemId: id,
      delta: -70,
      reason: 'brew-deduct',
    })

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })
    // A pulls the reconciled union back — must NOT add a second reconciliation.
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:02:00.000Z',
    })

    for (const db of [dbA, dbB]) {
      expect(await sumDeltas(db, id)).toBe(0)
      const recon = (
        await db.stockTransactions.where('inventoryItemId').equals(id).toArray()
      ).filter((t) => t.reason === 'sync-reconcile')
      expect(recon).toHaveLength(1)
    }
  })
})

describe('union-idempotence — two devices reconciling the same conflict independently', () => {
  it('derive the SAME deterministic compensating transaction (byte-identical), unioning to exactly ONE', () => {
    const itemId = crypto.randomUUID()
    const openingId = crypto.randomUUID()
    const aDeductId = crypto.randomUUID()
    const bDeductId = crypto.randomUUID()
    const theItem = item({ id: itemId, amount: 100 })
    const opening = {
      id: openingId,
      inventoryItemId: itemId,
      kind: 'hop' as const,
      delta: 100,
      unit: 'g' as const,
      reason: 'opening' as const,
      at: '2026-05-01T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    const aDeduct = {
      id: aDeductId,
      inventoryItemId: itemId,
      kind: 'hop' as const,
      delta: -60,
      unit: 'g' as const,
      reason: 'brew-deduct' as const,
      at: '2026-06-01T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    const bDeduct = {
      id: bDeductId,
      inventoryItemId: itemId,
      kind: 'hop' as const,
      delta: -60,
      unit: 'g' as const,
      reason: 'brew-deduct' as const,
      at: '2026-06-02T00:00:00.000Z',
      schemaVersion: 1 as const,
    }

    // Device A's perspective: local = {opening, aDeduct}; remote = {opening, bDeduct}.
    const aLocal = {
      ...emptyTables(),
      inventoryItems: [theItem],
      stockTransactions: [opening, aDeduct],
    }
    const aRemote = {
      ...emptyTables(),
      inventoryItems: [theItem],
      stockTransactions: [opening, bDeduct],
    }
    const mergedA = mergeDumpTables(aLocal, aRemote)

    // Device B's perspective — SYMMETRIC, computed with no knowledge of A's result.
    const bLocal = {
      ...emptyTables(),
      inventoryItems: [theItem],
      stockTransactions: [opening, bDeduct],
    }
    const bRemote = {
      ...emptyTables(),
      inventoryItems: [theItem],
      stockTransactions: [opening, aDeduct],
    }
    const mergedB = mergeDumpTables(bLocal, bRemote)

    const reconA = mergedA.stockTransactions.filter((t) => t.reason === 'sync-reconcile')
    const reconB = mergedB.stockTransactions.filter((t) => t.reason === 'sync-reconcile')
    expect(reconA).toHaveLength(1)
    expect(reconB).toHaveLength(1)
    expect(reconA[0]).toEqual(reconB[0]) // byte-identical, independently derived

    // A third merge round — the two devices' results meeting — must NOT double
    // the compensation, and the invariant must hold.
    const round2 = mergeDumpTables(mergedA, mergedB)
    const recon2 = round2.stockTransactions.filter((t) => t.reason === 'sync-reconcile')
    expect(recon2).toHaveLength(1)
    expect(round2.inventoryItems[0].amount).toBe(0)

    const collections = {
      ...emptyCollections(),
      inventoryItems: round2.inventoryItems,
      stockTransactions: round2.stockTransactions,
    }
    expect(() => assertLedgerInvariant(collections)).not.toThrow()
  })
})
