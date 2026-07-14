'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Batch } from '@/lib/brewing/types/batch'
import { batchRepo, type makeBatchRepo } from '@/lib/db/repos/batch'

type Repo = ReturnType<typeof makeBatchRepo>

export interface ActiveBatchController {
  setActive(b: Batch): void
  patch(p: Partial<Batch>): void
  flush(): Promise<void>
  loadActive(): Promise<Batch | null>
  clear(): void
  get(): Batch | null
}

/** Pure-of-React controller: debounced autosave + immediate milestone flush.
 *  Extracted so the timing logic is unit-testable with fake timers. */
export function makeActiveBatchController(
  repo: Repo,
  opts: { debounceMs?: number; onChange?: (b: Batch | null) => void } = {},
): ActiveBatchController {
  const debounceMs = opts.debounceMs ?? 1500
  let current: Batch | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function emit(): void {
    opts.onChange?.(current)
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!current) return
    current = await repo.save(current)
    emit()
  }

  return {
    setActive(b: Batch): void {
      current = b
      emit()
    },
    patch(p: Partial<Batch>): void {
      if (!current) return
      current = { ...current, ...p }
      emit()
      schedule()
    },
    flush,
    async loadActive(): Promise<Batch | null> {
      current = await repo.getActive()
      emit()
      return current
    },
    clear(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      current = null
      emit()
    },
    get(): Batch | null {
      return current
    },
  }
}

interface ActiveBatchState {
  activeId: string | null
  batch: Batch | null
  setActive: (b: Batch) => void
  patch: (p: Partial<Batch>) => void
  flush: () => Promise<void>
  loadActive: () => Promise<void>
  clear: () => void
}

const controller = makeActiveBatchController(batchRepo, {
  onChange: (b) => useActiveBatchStore.setState({ batch: b, activeId: b?.id ?? null }),
})

export const useActiveBatchStore = create<ActiveBatchState>()(
  persist(
    () => ({
      activeId: null as string | null,
      batch: null as Batch | null,
      setActive: (b: Batch) => controller.setActive(b),
      patch: (p: Partial<Batch>) => controller.patch(p),
      flush: () => controller.flush(),
      loadActive: async () => {
        await controller.loadActive()
      },
      clear: () => controller.clear(),
    }),
    {
      name: 'brew-active-batch',
      // Persist only the pointer; the body lives in Dexie and is rehydrated via loadActive().
      partialize: (s) => ({ activeId: s.activeId }),
    },
  ),
)

// Flush on tab hide / unload so a debounce window never loses data.
if (typeof window !== 'undefined') {
  const flushNow = () => {
    void useActiveBatchStore.getState().flush()
  }
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
  window.addEventListener('beforeunload', flushNow)
}
