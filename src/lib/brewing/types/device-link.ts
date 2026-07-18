import { z } from 'zod'

/**
 * A **DeviceLink** — the user's assignment "this sensor feeds that batch". One
 * row per physical device; the daemon's `POST /readings` (see
 * `src/lib/node/reading-ingest.ts`) resolves an incoming payload's normalized
 * `deviceKey` against these links to find which batch a reading belongs to.
 * No link for a `deviceKey` ⇒ the daemon can't place the reading anywhere and
 * responds `202 { status: 'unlinked', deviceKey }` without persisting it (see
 * the ingest module's doc comment for why that's the deliberate design, not a
 * gap) — the point of this table is to close that gap by making the
 * assignment explicit and user-owned rather than guessed.
 *
 * `deviceKey` is a normalized, provider-prefixed identity string, e.g.
 * `tilt:RED`, `ispindel:iSpindel001`, `rapt:<mac-or-name>`, `other:<name>` —
 * see the `*DeviceKey` helpers in `reading-ingest.ts` for exactly how each
 * adapter derives it. Not a Dexie-enforced-unique index (Dexie's `&unique`
 * would complicate the repo's upsert-by-key convenience method for little
 * benefit here) — `deviceLinksRepo.assign()` is the single write path the UI
 * uses and it upserts by `deviceKey` itself, so the app never creates two
 * live links for the same physical device.
 *
 * A synced, backed-up table (Dexie v12, `DumpV10`) — LWW-merged and
 * tombstoned-on-delete exactly like every other state table (see
 * `sync/merge.ts`, `db/repos/device-links.ts`).
 */
export const DeviceLinkSchema = z.object({
  id: z.string().uuid(),
  /** Normalized `provider:identity` device key — see module doc. */
  deviceKey: z.string().min(1),
  /** The batch this device's readings are currently assigned to. */
  batchId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
})

export type DeviceLink = z.infer<typeof DeviceLinkSchema>
