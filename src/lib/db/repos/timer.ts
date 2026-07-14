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
      await database.brewTimers.delete(id)
    },
    async deleteBySession(sessionId: string): Promise<void> {
      await database.brewTimers.where('sessionId').equals(sessionId).delete()
    },
  }
}

export const timerRepo = makeTimerRepo(db)
