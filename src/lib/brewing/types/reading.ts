import { z } from 'zod'

/**
 * A single fermentation reading for a batch — logged every day or two during
 * fermentation. Keyed by the stable `Batch.id` (NOT the ephemeral
 * `fermenterBoardId`). Temperature is stored canonical in °C (`tempC`); the UI
 * converts to the user's `Units` setting for display.
 */
export const ReadingSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string(),
  at: z.string(), // ISO timestamp
  gravity: z.number().optional(),
  tempC: z.number().optional(),
  ph: z.number().optional(),
  note: z.string().optional(),
  schemaVersion: z.literal(1),
})

export type Reading = z.infer<typeof ReadingSchema>
