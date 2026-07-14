'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BREW_MANUAL } from '@/lib/brewing/process/manual'
import { type BrewSession, reduce, type SessionAction } from '@/lib/brewing/process/session'
import type { ProcessStep } from '@/lib/brewing/process/types'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Volumes } from '@/lib/brewing/types/results'
import { sessionRepo } from '@/lib/db/repos/session'
import { applyEffects } from '@/stores/board-bridge'

const AUTOSAVE_MS = 1500

// Milestone actions flush immediately (no debounce) so a sleep/close never loses them.
const MILESTONE: ReadonlySet<SessionAction['t']> = new Set([
  'completeStep',
  'setChoice',
  'pause',
  'resume',
  'complete',
  'abort',
  'log',
])

interface SessionState {
  activeId: string | null
  session: BrewSession | null
  lastRejection: string | null
  dispatch: (action: SessionAction, ctx?: { recipe?: Recipe; volumes?: Volumes }) => void
  loadActive: () => Promise<void>
  setActive: (session: BrewSession) => Promise<void>
  flush: () => Promise<void>
  clearRejection: () => void
  /** Pause the active brew (running → paused). Milestone-flushed. */
  pause: () => void
  /** Resume a paused brew (paused → running). Milestone-flushed. */
  resume: () => void
  /** Finalize the active brew now (→ done). Milestone-flushed. */
  complete: () => void
  /** Drop the in-memory session + persisted pointer so a new brew can start.
   *  Cancels any pending debounced save. Leaves the (done/aborted) body in Dexie —
   *  getActive() filters running|paused so it won't be resurrected. */
  clear: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => {
      const scheduleSave = (immediate: boolean) => {
        if (saveTimer) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
        const doSave = async () => {
          const s = get().session
          if (s) await sessionRepo.save(s)
        }
        if (immediate) {
          void doSave()
        } else {
          saveTimer = setTimeout(() => void doSave(), AUTOSAVE_MS)
        }
      }

      return {
        activeId: null,
        session: null,
        lastRejection: null,

        dispatch: (action, ctx = {}) => {
          const current = get().session
          if (!current) return
          const res = reduce(current, action, BREW_MANUAL, ctx)
          if (res.rejected) {
            set({ lastRejection: res.rejected.reason })
            return
          }
          set({ session: res.session, activeId: res.session.id, lastRejection: null })
          scheduleSave(MILESTONE.has(action.t))
        },

        loadActive: async () => {
          // Cancel any pending debounced save before replacing the in-memory
          // session. Without this cancellation a pending 1.5s debounce from a
          // prior skip/goto dispatch (non-milestone) would fire AFTER the load
          // and overwrite the newly-loaded session with stale data.
          if (saveTimer) {
            clearTimeout(saveTimer)
            saveTimer = null
          }
          const id = get().activeId
          // Prefer the persisted id; fall back to the repo's running/paused lookup.
          const candidate = id ? await sessionRepo.get(id) : await sessionRepo.getActive()
          // Only adopt a genuinely active session. A persisted id that now points
          // at a done/aborted/archived/idle body is stale — clear BOTH the memory
          // session and the pointer (persisted null via partialize) instead of
          // letting the dead id linger in localStorage. getActive() already filters
          // running|paused, so the no-id fallback path is unaffected.
          const s =
            candidate && (candidate.lifecycle === 'running' || candidate.lifecycle === 'paused')
              ? candidate
              : null
          set({ session: s, activeId: s?.id ?? null })
        },

        setActive: async (session) => {
          const saved = await sessionRepo.save(session)
          set({ session: saved, activeId: saved.id, lastRejection: null })
        },

        flush: async () => {
          if (saveTimer) {
            clearTimeout(saveTimer)
            saveTimer = null
          }
          const s = get().session
          if (s) await sessionRepo.save(s)
        },

        clearRejection: () => set({ lastRejection: null }),

        pause: () => get().dispatch({ t: 'pause', now: new Date().toISOString() }),
        resume: () => get().dispatch({ t: 'resume', now: new Date().toISOString() }),
        complete: () => get().dispatch({ t: 'complete', now: new Date().toISOString() }),

        clear: () => {
          // Cancel any pending debounced save so it can't fire after we null the
          // session and clobber Dexie / re-persist a stale pointer.
          if (saveTimer) {
            clearTimeout(saveTimer)
            saveTimer = null
          }
          // Nulling activeId is persisted through partialize → localStorage,
          // which stops loadActive() from rehydrating this session by id.
          set({ session: null, activeId: null, lastRejection: null })
        },
      }
    },
    {
      name: 'brew-session',
      // Only the active id is persisted to localStorage; the body lives in Dexie.
      partialize: (s) => ({ activeId: s.activeId }),
    },
  ),
)

// Flush on tab hide / unload so a milestone-less debounce window never loses data.
if (typeof window !== 'undefined') {
  const flushNow = () => {
    void useSessionStore.getState().flush()
  }
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
  window.addEventListener('beforeunload', flushNow)
}

/**
 * Push a step's board effects to the system-store via the pure projection + bridge.
 * Called from the session dispatch path on step enter/complete. Board stays a
 * projection of the canonical BrewSession — no parallel state tree.
 */
export function projectStepEffects(
  session: BrewSession,
  step: ProcessStep,
  phase: 'enter' | 'complete',
): void {
  const effects = phase === 'enter' ? step.enterEffects : step.completeEffects
  if (!effects || effects.length === 0) return
  applyEffects(effects, session)
}
