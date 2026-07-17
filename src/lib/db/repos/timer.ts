import { type BrewTimer, BrewTimerSchema } from '@/lib/brewing/types/timer'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeTimerRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<BrewTimer | null> {
      const row = await database.brewTimers.get(id)
      return row ? BrewTimerSchema.parse(row) : null
    },
    async save(t: BrewTimer): Promise<BrewTimer> {
      const validated = BrewTimerSchema.parse(t)
      await database.brewTimers.put(validated)
      return validated
    },
    async saveMany(ts: BrewTimer[]): Promise<BrewTimer[]> {
      const validated = ts.map((t) => BrewTimerSchema.parse(t))
      await database.brewTimers.bulkPut(validated)
      return validated
    },
    async bySession(sessionId: string): Promise<BrewTimer[]> {
      const rows = await database.brewTimers.where('sessionId').equals(sessionId).toArray()
      return rows.map((r) => BrewTimerSchema.parse(r))
    },
    async armed(): Promise<BrewTimer[]> {
      const rows = await database.brewTimers.filter((t) => t.status === 'armed').toArray()
      return rows.map((r) => BrewTimerSchema.parse(r))
    },
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction('rw', database.brewTimers, database.rowTombstones, async () => {
        await database.brewTimers.delete(id)
        await database.rowTombstones.put({ id, table: 'brewTimers', deletedAt })
      })
    },
    async deleteBySession(sessionId: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction('rw', database.brewTimers, database.rowTombstones, async () => {
        const cascaded = await database.brewTimers.where('sessionId').equals(sessionId).toArray()
        if (cascaded.length === 0) return
        await database.brewTimers.bulkDelete(cascaded.map((t) => t.id))
        await database.rowTombstones.bulkPut(
          cascaded.map((t) => ({ id: t.id, table: 'brewTimers', deletedAt })),
        )
      })
    },
  }
}

export const timerRepo = makeTimerRepo(db)
