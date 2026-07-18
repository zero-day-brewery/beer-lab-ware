import { afterEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { makeBackupService } from '@/lib/db/backup'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { BrewDB } from '@/lib/db/schema'
import { syncOnce } from '@/lib/sync/sync-client'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-inv-${Date.now()}-${n++}`)
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

describe('sync preserves the ledger invariant amount === Σ deltas', () => {
  it('reprojects amount from the merged ledger after a concurrent same-item deduct', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()

    // both start with item X @ 100. Each device's v7 migration minted its OWN
    // opening txn id (crypto.randomUUID) — so the ids differ across devices, and
    // the merge must dedupe them by inventoryItemId (else the amount double-counts).
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
    // A deducts 30, B deducts 20 (independent brew-deducts, distinct txn ids)
    await makeStockTransactionsRepo(dbA).applyStockChange({
      inventoryItemId: id,
      delta: -30,
      reason: 'brew-deduct',
    })
    await makeStockTransactionsRepo(dbB).applyStockChange({
      inventoryItemId: id,
      delta: -20,
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
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:02:00.000Z',
    })

    // converged ledger: opening +100, -30, -20 → amount 50 on BOTH devices
    for (const db of [dbA, dbB]) {
      const it = await db.inventoryItems.get(id)
      const sum = await sumDeltas(db, id)
      expect(sum).toBe(50)
      expect(it?.amount).toBe(sum) // invariant holds post-sync
    }
  })
})

describe('sync treats settings as device-local (no cross-device clobber)', () => {
  it('does not overwrite device B settings with device A on sync', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const eq = crypto.randomUUID()
    await dbA.settings.put({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: eq,
      theme: 'matrix',
      schemaVersion: 1,
    })
    await dbB.settings.put({
      id: 'global',
      units: 'imperial',
      defaultEquipmentProfileId: eq,
      theme: 'neon',
      schemaVersion: 1,
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

    const bSettings = await dbB.settings.get('global')
    expect((bSettings as { theme?: string })?.theme).toBe('neon') // B keeps its own
  })
})
