/**
 * Pure timer-tick logic. The store calls these on each 1s tick and on
 * hydrate; all firing decisions live here so they are unit-testable and
 * free of DOM/Dexie/fetch.
 */
import type { BrewTimer } from '@/lib/brewing/types/timer'

export interface TickResult {
  fired: BrewTimer[]
  stillArmed: BrewTimer[]
}

/** Partition armed timers into due (fired, stamped) vs not-yet-due. */
export function resolveDueTimers(timers: BrewTimer[], now: string): TickResult {
  const nowMs = new Date(now).getTime()
  const fired: BrewTimer[] = []
  const stillArmed: BrewTimer[] = []
  for (const t of timers) {
    if (t.status !== 'armed') continue
    if (new Date(t.fireAt).getTime() <= nowMs) {
      fired.push({ ...t, status: 'fired', firedAt: now })
    } else {
      stillArmed.push(t)
    }
  }
  return { fired, stillArmed }
}

/** Armed timers whose fireAt is strictly in the past — fired while away. */
export function missedWhileAway(timers: BrewTimer[], now: string): BrewTimer[] {
  const nowMs = new Date(now).getTime()
  return timers.filter((t) => t.status === 'armed' && new Date(t.fireAt).getTime() < nowMs)
}
