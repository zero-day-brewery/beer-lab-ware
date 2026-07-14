import { type YeastLot, YeastLotSchema } from '@/lib/brewing/types/yeast-lot'
import { type BrewDB, db } from '@/lib/db/schema'

/**
 * Yeast-lots repo. Same conventions as the other repos: a `make…(database)`
 * factory (test-injectable), Zod `parse` on every read AND write boundary, and
 * `save` stamps `updatedAt`. Lots are standalone rows (not seeded), so delete
 * is a plain remove — no seed-tombstone bookkeeping.
 */
export function makeYeastLotsRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<YeastLot | undefined> {
      const row = await database.yeastLots.get(id)
      return row ? YeastLotSchema.parse(row) : undefined
    },

    async list(): Promise<YeastLot[]> {
      const rows = await database.yeastLots.toArray()
      return rows.map((r) => YeastLotSchema.parse(r))
    },

    /** In-stock + all lots of a strain (case-insensitive), for the selection engine. */
    async listByStrain(strain: string): Promise<YeastLot[]> {
      const target = strain.trim().toLowerCase()
      const rows = await database.yeastLots.toArray()
      return rows
        .map((r) => YeastLotSchema.parse(r))
        .filter((l) => l.strain.trim().toLowerCase() === target)
    },

    /** Insert/replace a lot, stamping `updatedAt`. Parses before write. */
    async save(lot: YeastLot): Promise<YeastLot> {
      const next = YeastLotSchema.parse({ ...lot, updatedAt: new Date().toISOString() })
      await database.yeastLots.put(next)
      return next
    },

    /**
     * Decrement a lot's on-hand quantity by `amount` (clamped at 0), stamping
     * `updatedAt`. Returns the updated lot, or undefined if the lot is gone.
     * The brew-time "consume this lot" primitive (see deduction wiring).
     */
    async consume(id: string, amount: number): Promise<YeastLot | undefined> {
      return database.transaction('rw', database.yeastLots, async () => {
        const row = await database.yeastLots.get(id)
        if (!row) return undefined
        const lot = YeastLotSchema.parse(row)
        const next = YeastLotSchema.parse({
          ...lot,
          quantity: Math.max(0, lot.quantity - amount),
          updatedAt: new Date().toISOString(),
        })
        await database.yeastLots.put(next)
        return next
      })
    },

    async remove(id: string): Promise<void> {
      await database.yeastLots.delete(id)
    },
  }
}

export const yeastLotsRepo = makeYeastLotsRepo(db)
