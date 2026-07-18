import { type DeviceLink, DeviceLinkSchema } from '@/lib/brewing/types/device-link'
import { type BrewDB, db } from '@/lib/db/schema'
import { newId } from '@/lib/utils/id'

/**
 * DeviceLinks repo — "this sensor feeds that batch" (see the type module doc
 * for the full picture). Same conventions as every other repo: a
 * `make…(database)` factory (test-injectable), Zod `parse` on every read AND
 * write boundary, delete writes a `rowTombstone` IN THE SAME transaction as
 * the delete (see `db/repos/inventory.ts` for the pattern this follows).
 */
export function makeDeviceLinksRepo(database: BrewDB) {
  return {
    async list(): Promise<DeviceLink[]> {
      const rows = await database.deviceLinks.orderBy('deviceKey').toArray()
      return rows.map((r) => DeviceLinkSchema.parse(r))
    },

    async get(id: string): Promise<DeviceLink | undefined> {
      const row = await database.deviceLinks.get(id)
      return row ? DeviceLinkSchema.parse(row) : undefined
    },

    /** The lookup the sync daemon's ingest resolver mirrors client-side —
     *  primarily useful for the Settings UI ("is this device already linked
     *  to a different batch?"). */
    async getByDeviceKey(deviceKey: string): Promise<DeviceLink | undefined> {
      const row = await database.deviceLinks.where('deviceKey').equals(deviceKey).first()
      return row ? DeviceLinkSchema.parse(row) : undefined
    },

    /**
     * Upsert a device→batch assignment BY `deviceKey`: if a link already
     * exists for this key its `batchId` is updated in place (same `id`,
     * `createdAt` preserved); otherwise a new link is created. This is the
     * ONE write path the "Sensor devices" UI uses for both add AND
     * reassign — it deliberately never creates a second live link for the
     * same physical device.
     */
    async assign(deviceKey: string, batchId: string): Promise<DeviceLink> {
      const trimmedKey = deviceKey.trim()
      const now = new Date().toISOString()
      const existing = await database.deviceLinks.where('deviceKey').equals(trimmedKey).first()
      const next = DeviceLinkSchema.parse({
        id: existing?.id ?? newId(),
        deviceKey: trimmedKey,
        batchId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        schemaVersion: 1,
      })
      await database.deviceLinks.put(next)
      return next
    },

    async remove(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction('rw', database.deviceLinks, database.rowTombstones, async () => {
        await database.deviceLinks.delete(id)
        await database.rowTombstones.put({ id, table: 'deviceLinks', deletedAt })
      })
    },
  }
}

export const deviceLinksRepo = makeDeviceLinksRepo(db)
