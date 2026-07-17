import { type EquipmentProfile, EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeEquipmentRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<EquipmentProfile | null> {
      const row = await database.equipmentProfiles.get(id)
      return row ? EquipmentProfileSchema.parse(row) : null
    },
    async list(): Promise<EquipmentProfile[]> {
      const rows = await database.equipmentProfiles.orderBy('name').toArray()
      return rows.map((r) => EquipmentProfileSchema.parse(r))
    },
    async getDefault(): Promise<EquipmentProfile | null> {
      const row = await database.equipmentProfiles.filter((p) => p.isDefault === true).first()
      return row ? EquipmentProfileSchema.parse(row) : null
    },
    async save(p: EquipmentProfile): Promise<EquipmentProfile> {
      const validated = EquipmentProfileSchema.parse(p)
      await database.transaction('rw', database.equipmentProfiles, async () => {
        // Enforce a single default: clear isDefault on every other profile.
        if (validated.isDefault) {
          const others = await database.equipmentProfiles
            .filter((o) => o.id !== validated.id && o.isDefault === true)
            .toArray()
          await Promise.all(
            others.map((o) => database.equipmentProfiles.put({ ...o, isDefault: false })),
          )
        }
        await database.equipmentProfiles.put(validated)
      })
      return validated
    },
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction(
        'rw',
        database.equipmentProfiles,
        database.seedTombstones,
        database.rowTombstones,
        async () => {
          await database.equipmentProfiles.delete(id)
          // Tombstone so the seeder won't resurrect a deleted seed profile on relaunch.
          await database.seedTombstones.put({ id })
          await database.rowTombstones.put({ id, table: 'equipmentProfiles', deletedAt })
        },
      )
    },
  }
}

export const equipmentRepo = makeEquipmentRepo(db)
