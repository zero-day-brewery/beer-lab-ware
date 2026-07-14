'use client'
import { create } from 'zustand'
import { resolveDueTimers } from '@/lib/brewing/process/timer-tick'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import { timerRepo } from '@/lib/db/repos/timer'

interface TimerState {
  timers: BrewTimer[]
  missedOnLoad: BrewTimer[]
  setTimers: (timers: BrewTimer[]) => void
  load: (sessionId: string) => Promise<void>
  arm: (timers: BrewTimer[]) => Promise<void>
  cancel: (id: string) => Promise<void>
  tick: () => Promise<void>
}

const useStore = create<TimerState>((set, get) => ({
  timers: [],
  missedOnLoad: [],
  setTimers: (timers) => set({ timers }),
  async load(sessionId) {
    const rows = await timerRepo.bySession(sessionId)
    // Re-fire missed timers as one catch-up pass (fireAt already absolute).
    const { fired, stillArmed } = resolveDueTimers(rows, new Date().toISOString())
    const settled = rows.filter((t) => t.status !== 'armed')
    if (fired.length) await timerRepo.saveMany(fired)
    // Merge onto CURRENT store state (not stale pre-await snapshot) so any
    // arm()/cancel() calls that resolved during the await are not clobbered.
    const firedIds = new Set(fired.map((f) => f.id))
    const currentIds = new Set(get().timers.map((t) => t.id))
    const newTimers = [...settled, ...fired, ...stillArmed].filter((t) => !currentIds.has(t.id))
    const mergedTimers = get().timers.map((t) =>
      firedIds.has(t.id)
        ? { ...t, status: 'fired' as const, firedAt: fired.find((f) => f.id === t.id)?.firedAt }
        : t,
    )
    set({ timers: [...mergedTimers, ...newTimers], missedOnLoad: fired })
  },
  async arm(timers) {
    await timerRepo.saveMany(timers)
    set({ timers: [...get().timers, ...timers] })
  },
  async cancel(id) {
    const existing = await timerRepo.get(id)
    if (!existing) return
    const cancelled: BrewTimer = { ...existing, status: 'cancelled' }
    await timerRepo.save(cancelled)
    set({ timers: get().timers.map((t) => (t.id === id ? cancelled : t)) })
  },
  async tick() {
    const snapshot = get().timers
    const { fired } = resolveDueTimers(snapshot, new Date().toISOString())
    if (!fired.length) return
    await timerRepo.saveMany(fired)
    // Apply fired status onto CURRENT store state (not stale pre-await snapshot)
    // so arm()/cancel() calls that resolved during the await are not lost.
    const firedIds = new Set(fired.map((f) => f.id))
    const now = new Date().toISOString()
    set({
      timers: get().timers.map((t) =>
        firedIds.has(t.id) ? { ...t, status: 'fired' as const, firedAt: now } : t,
      ),
    })
  },
}))

let interval: ReturnType<typeof setInterval> | null = null

function ensureTick() {
  if (interval) return
  interval = setInterval(() => {
    void useStore.getState().tick()
  }, 1000)
}

export function useTimerStore(): TimerState {
  ensureTick()
  return useStore()
}

export const timerStore = useStore
