import type { BrewSession } from '@/lib/brewing/process/session'
import { BrewSessionSchema } from '@/lib/brewing/types/session'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeSessionRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<BrewSession | null> {
      const row = await database.brewSessions.get(id)
      return row ? (BrewSessionSchema.parse(row) as BrewSession) : null
    },
    async list(): Promise<BrewSession[]> {
      const rows = await database.brewSessions.orderBy('updatedAt').reverse().toArray()
      return rows.map((r) => BrewSessionSchema.parse(r) as BrewSession)
    },
    async save(s: BrewSession): Promise<BrewSession> {
      const stamped = { ...s, updatedAt: new Date().toISOString() }
      const validated = BrewSessionSchema.parse(stamped) as BrewSession
      await database.brewSessions.put(validated)
      return validated
    },
    async delete(id: string): Promise<void> {
      await database.brewSessions.delete(id)
    },
    /** The single in-flight session. Boolean/enum where() on Dexie is unreliable — use .filter(). */
    async getActive(): Promise<BrewSession | null> {
      const row = await database.brewSessions
        .filter((s) => s.lifecycle === 'running' || s.lifecycle === 'paused')
        .first()
      return row ? (BrewSessionSchema.parse(row) as BrewSession) : null
    },
  }
}

export const sessionRepo = makeSessionRepo(db)
