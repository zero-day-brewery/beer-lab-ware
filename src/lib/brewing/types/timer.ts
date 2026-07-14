import { z } from 'zod'

/**
 * Persisted brew-day timer row. Superset of the runtime TimerState
 * (session.ts) plus sessionId so Dexie can index by session. Absolute
 * fireAt (ISO) is stored — never remaining seconds — so timers survive
 * reload / a closed laptop and missed ones are re-fired on hydrate.
 */
export const BrewTimerSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().uuid(),
  stepId: z.string().min(1),
  label: z.string(),
  durationMin: z.number().nonnegative(),
  fireAt: z.string().datetime(),
  status: z.enum(['armed', 'fired', 'cancelled']),
  firedAt: z.string().datetime().optional(),
  isBoilMaster: z.boolean(),
  parentId: z.string().optional(),
})

export type BrewTimer = z.infer<typeof BrewTimerSchema>
