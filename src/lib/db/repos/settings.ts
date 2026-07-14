import { type Settings, SettingsSchema } from '@/lib/brewing/types/settings'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeSettingsRepo(database: BrewDB) {
  return {
    async get(): Promise<Settings | null> {
      const row = await database.settings.get('global')
      return row ? SettingsSchema.parse(row) : null
    },
    async save(s: Settings): Promise<Settings> {
      const validated = SettingsSchema.parse(s)
      await database.settings.put(validated)
      return validated
    },
  }
}

export const settingsRepo = makeSettingsRepo(db)
