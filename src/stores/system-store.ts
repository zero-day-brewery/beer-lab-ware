'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newId } from '@/lib/utils/id'

export type StationStatus = 'idle' | 'active'
export type FermStatus = 'empty' | 'fermenting' | 'cold-crash' | 'conditioning' | 'packaged'
export type CoolerKind = 'counterflow' | 'glycol'

export interface Fermenter {
  id: string
  name: string
  batch: string
  status: FermStatus
  // Recipe link (#1) — denormalized so the card is self-contained
  recipeId?: string
  recipeName?: string
  // Vitals (#2) — manual entry from EasyDens / Inkbird
  og?: number
  sg?: number
  fg?: number
  tempCurrent?: number
  tempTarget?: number
  // Timeline (#3)
  pitchedAt?: string
  // Logbook link (Guided Brew Flow) — the only system-store field the flow adds.
  batchId?: string
}

// A configurable brew system (was the bare `brew` scalar). The B40pro seed folds
// in the view's old hardcoded name/model/component constants.
export interface BrewSystem {
  id: string
  name: string
  model?: string
  components: string[]
  status: StationStatus
}

// A configurable chiller/cooler (was the bare `wortChiller` + `cooler` scalars).
// `kind` distinguishes the wort-side counterflow chiller from the glycol cooler.
export interface Cooler {
  id: string
  kind: CoolerKind
  name: string
  model?: string
  components: string[]
  status: StationStatus
}

export interface CurrentBrew {
  recipeId?: string
  recipeName?: string
  sourceProfileName?: string
  additionsSummary?: string
  skipped?: boolean
  startedAt?: string
}

interface SystemState {
  brewSystems: BrewSystem[]
  coolers: Cooler[]
  fermenters: Fermenter[]
  currentBrew: CurrentBrew | null
  // Brew-system ops
  addBrewSystem: () => void
  removeBrewSystem: (id: string) => void
  patchBrewSystem: (id: string, patch: Partial<BrewSystem>) => void
  cycleBrewSystem: (id: string) => void
  // Cooler ops
  addCooler: (kind: CoolerKind) => void
  removeCooler: (id: string) => void
  patchCooler: (id: string, patch: Partial<Cooler>) => void
  cycleCooler: (id: string) => void
  // Fermenter ops
  addFermenter: () => void
  removeFermenter: (id: string) => void
  cycleFermenter: (id: string) => void
  patchFermenter: (id: string, patch: Partial<Fermenter>) => void
  // Board lifecycle
  reset: () => void
  startBrew: (b: CurrentBrew) => void
  stopBrew: () => void
}

export const FERM_FLOW: FermStatus[] = [
  'empty',
  'fermenting',
  'cold-crash',
  'conditioning',
  'packaged',
]

const nextFerm = (s: FermStatus): FermStatus =>
  FERM_FLOW[(FERM_FLOW.indexOf(s) + 1) % FERM_FLOW.length]

const toggle = (s: StationStatus): StationStatus => (s === 'idle' ? 'active' : 'idle')

// Seed component lists — folded out of system-view.tsx so the store is the single
// source of truth for both the default board and the persist migration.
// The counterflow chiller is a built-in feature of the Brewtools B40pro, so it
// lives here as a component of the brew system — NOT as a standalone default cooler.
export const BREW_COMPONENTS = [
  'Steam Hat',
  'Trubinator S',
  'Sparge Manifold',
  'Recirc Pump',
  'Counterflow Chiller',
]
export const CFC_COMPONENTS = ['SS304 CFC', '4× TC34mm', 'Wort Pump', 'Return Sensor']
export const GLYCOL_COMPONENTS = ['Cooling Pump ×3', 'Glycol Manifold', 'Flex Heater']

const seedBrewSystem = (status: StationStatus = 'idle'): BrewSystem => ({
  id: 'b1',
  name: 'Brew System',
  model: 'Brewtools B40pro',
  components: [...BREW_COMPONENTS],
  status,
})

const seedGlycol = (status: StationStatus = 'idle'): Cooler => ({
  id: 'glycol',
  kind: 'glycol',
  name: 'Glycol Cooler',
  model: 'Penguin 1/3 HP',
  components: [...GLYCOL_COMPONENTS],
  status,
})

const freshBrewSystems = (): BrewSystem[] => [seedBrewSystem()]
// DEFAULT coolers are glycol-only — the counterflow chiller lives inside the
// B40pro brew system (see BREW_COMPONENTS). A standalone counterflow is still
// user-addable for non-B40pro rigs (see `addCooler`).
const freshCoolers = (): Cooler[] => [seedGlycol()]

const freshFermenters = (): Fermenter[] => [
  { id: 'f1', name: 'Fermenter 1', batch: '', status: 'empty' },
  { id: 'f2', name: 'Fermenter 2', batch: '', status: 'empty' },
  { id: 'f3', name: 'Fermenter 3', batch: '', status: 'empty' },
  { id: 'f4', name: 'Fermenter 4', batch: '', status: 'empty' },
]

// Wipe per-batch data when a vessel is emptied so the next brew starts clean.
const emptied = (f: Fermenter): Fermenter => ({
  id: f.id,
  name: f.name,
  batch: '',
  status: 'empty',
  tempTarget: f.tempTarget, // keep the target setpoint, clear the rest
})

// ---- persist migration ----
// The subset actually written to localStorage (functions never serialize).
export type SystemFlowPersisted = Pick<
  SystemState,
  'brewSystems' | 'coolers' | 'fermenters' | 'currentBrew'
>

// The pre-v1 persisted shape: three bare station scalars + the fermenter array.
interface LegacySystemState {
  brew?: StationStatus
  wortChiller?: StationStatus
  cooler?: StationStatus
  fermenters?: Fermenter[]
  currentBrew?: CurrentBrew | null
}

const migrateLegacy = (old: LegacySystemState): SystemFlowPersisted => ({
  // Fold the old wort-chiller status into the brew system (the counterflow chiller
  // is now a B40pro component, seeded via BREW_COMPONENTS — no standalone cooler).
  brewSystems: [
    seedBrewSystem(old.brew === 'active' || old.wortChiller === 'active' ? 'active' : 'idle'),
  ],
  // DEFAULT coolers are glycol-only now.
  coolers: [seedGlycol(old.cooler ?? 'idle')],
  // Existing fermenters (and their live per-batch data) MUST survive the upgrade.
  fermenters: old.fermenters ?? freshFermenters(),
  currentBrew: old.currentBrew ?? null,
})

// v1 → v2: retire the DEFAULT-seeded counterflow cooler (`cfc`) — the B40pro's
// counterflow chiller is a component of the brew system, not a standalone cooler.
// User-added coolers (and fermenters) are preserved untouched.
const migrateV1toV2 = (s: SystemFlowPersisted): SystemFlowPersisted => {
  const cfcWasActive = s.coolers.some((c) => c.id === 'cfc' && c.status === 'active')
  return {
    ...s,
    // Drop ONLY the default-seeded counterflow cooler; keep any user-added coolers.
    coolers: s.coolers.filter((c) => c.id !== 'cfc'),
    // Fold the counterflow into the seeded B40pro brew system: ensure the component
    // is listed, and carry over its active state if the dropped cfc was running.
    brewSystems: s.brewSystems.map((b) => {
      if (b.id !== 'b1') return b
      const components = b.components.includes('Counterflow Chiller')
        ? b.components
        : [...b.components, 'Counterflow Chiller']
      return { ...b, components, status: cfcWasActive ? 'active' : b.status }
    }),
  }
}

/**
 * Persist migration:
 *  - v0 (scalar stations) → v1 (add/removable equipment arrays), then
 *  - v1 → v2 (counterflow chiller folded into the brew system; glycol-only default coolers).
 * migrateLegacy already emits the v2 shape, so a v0 blob upgrades straight through.
 */
export function migrateSystemFlow(persisted: unknown, version: number): SystemFlowPersisted {
  if (version < 1) return migrateLegacy((persisted ?? {}) as LegacySystemState)
  if (version < 2) return migrateV1toV2(persisted as SystemFlowPersisted)
  return persisted as SystemFlowPersisted
}

export const useSystemStore = create<SystemState>()(
  persist(
    (set) => ({
      brewSystems: freshBrewSystems(),
      coolers: freshCoolers(),
      fermenters: freshFermenters(),
      currentBrew: null,

      addBrewSystem: () =>
        set((s) => ({
          brewSystems: [
            ...s.brewSystems,
            { id: newId(), name: 'New brew system', components: [], status: 'idle' },
          ],
        })),
      removeBrewSystem: (id) =>
        set((s) => ({ brewSystems: s.brewSystems.filter((b) => b.id !== id) })),
      patchBrewSystem: (id, patch) =>
        set((s) => ({
          brewSystems: s.brewSystems.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        })),
      cycleBrewSystem: (id) =>
        set((s) => ({
          brewSystems: s.brewSystems.map((b) =>
            b.id === id ? { ...b, status: toggle(b.status) } : b,
          ),
        })),

      addCooler: (kind) =>
        set((s) => ({
          coolers: [
            ...s.coolers,
            {
              id: newId(),
              kind,
              name: kind === 'glycol' ? 'New glycol cooler' : 'New counterflow cooler',
              components: [],
              status: 'idle',
            },
          ],
        })),
      removeCooler: (id) => set((s) => ({ coolers: s.coolers.filter((c) => c.id !== id) })),
      patchCooler: (id, patch) =>
        set((s) => ({ coolers: s.coolers.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      cycleCooler: (id) =>
        set((s) => ({
          coolers: s.coolers.map((c) => (c.id === id ? { ...c, status: toggle(c.status) } : c)),
        })),

      addFermenter: () =>
        set((s) => ({
          fermenters: [
            ...s.fermenters,
            {
              id: newId(),
              name: `Fermenter ${s.fermenters.length + 1}`,
              batch: '',
              status: 'empty',
            },
          ],
        })),
      removeFermenter: (id) =>
        set((s) => ({ fermenters: s.fermenters.filter((f) => f.id !== id) })),
      cycleFermenter: (id) =>
        set((s) => ({
          fermenters: s.fermenters.map((f) => {
            if (f.id !== id) return f
            const status = nextFerm(f.status)
            if (status === 'empty') return emptied(f)
            // Stamp the pitch date the first time it starts fermenting
            const pitchedAt =
              status === 'fermenting' && !f.pitchedAt ? new Date().toISOString() : f.pitchedAt
            return { ...f, status, pitchedAt }
          }),
        })),
      patchFermenter: (id, patch) =>
        set((s) => ({
          fermenters: s.fermenters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),

      reset: () =>
        set({
          brewSystems: freshBrewSystems(),
          coolers: freshCoolers(),
          fermenters: freshFermenters(),
        }),
      startBrew: (b) =>
        set((s) => ({
          brewSystems: s.brewSystems.map((bs) => ({ ...bs, status: 'active' })),
          currentBrew: { ...b, startedAt: new Date().toISOString() },
        })),
      stopBrew: () =>
        set((s) => ({
          brewSystems: s.brewSystems.map((bs) => ({ ...bs, status: 'idle' })),
          currentBrew: null,
        })),
    }),
    {
      name: 'brew-system-flow',
      version: 2,
      migrate: migrateSystemFlow,
      partialize: (s): SystemFlowPersisted => ({
        brewSystems: s.brewSystems,
        coolers: s.coolers,
        fermenters: s.fermenters,
        currentBrew: s.currentBrew,
      }),
    },
  ),
)

// ---- fermentation math ----
export const abv = (og?: number, sg?: number): number | null =>
  og != null && sg != null && og > sg ? (og - sg) * 131.25 : null

export const attenuation = (og?: number, sg?: number): number | null =>
  og != null && sg != null && og > 1 ? ((og - sg) / (og - 1)) * 100 : null

export const progressPct = (og?: number, sg?: number, fg?: number): number | null => {
  if (og == null || sg == null || fg == null || og <= fg) return null
  return Math.max(0, Math.min(100, ((og - sg) / (og - fg)) * 100))
}

export const daysSince = (iso?: string): number | null => {
  if (!iso) return null
  const ms = Date.now() - Date.parse(iso)
  return ms >= 0 ? Math.floor(ms / 86_400_000) : null
}
