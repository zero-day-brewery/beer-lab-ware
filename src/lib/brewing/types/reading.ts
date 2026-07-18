import { z } from 'zod'

/**
 * Where a reading came from. `undefined`/absent means a manually-typed reading
 * (the pre-existing, only path before automatic sensor ingestion) — every
 * historical row and every hand-entered one stays valid with no migration.
 * The others are set by the sync daemon's `POST /readings` (see
 * `src/lib/node/reading-ingest.ts`): `tilt`/`ispindel`/`rapt` when the device
 * type was positively identified from its payload shape, `other` for the
 * generic escape-hatch shape or an unrecognized-but-parseable device name.
 */
export const ReadingSourceSchema = z.enum(['manual', 'tilt', 'ispindel', 'rapt', 'other'])
export type ReadingSource = z.infer<typeof ReadingSourceSchema>

/**
 * A single fermentation reading for a batch — logged every day or two during
 * fermentation. Keyed by the stable `Batch.id` (NOT the ephemeral
 * `fermenterBoardId`). Temperature is stored canonical in °C (`tempC`); the UI
 * converts to the user's `Units` setting for display.
 *
 * `source`/`deviceId` (additive, optional — no Dexie version bump, no
 * migration) record automatic sensor provenance when the daemon's
 * `POST /readings` created the row; both are absent for a manual entry.
 */
export const ReadingSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string(),
  at: z.string(), // ISO timestamp
  gravity: z.number().optional(),
  tempC: z.number().optional(),
  ph: z.number().optional(),
  note: z.string().optional(),
  /** Absent = manual entry. Set by automatic sensor ingestion. */
  source: ReadingSourceSchema.optional(),
  /** Raw device identity as reported by the sensor (e.g. a Tilt color, an
   *  iSpindel name/ID) — informational, distinct from `deviceKey` on
   *  `DeviceLink` (which is the normalized `provider:identity` lookup key). */
  deviceId: z.string().optional(),
  schemaVersion: z.literal(1),
})

export type Reading = z.infer<typeof ReadingSchema>
