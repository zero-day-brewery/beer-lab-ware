/**
 * Pure Recipes-Home dashboard aggregator.
 *
 * Mirrors the Report view pattern (`src/lib/brewing/report/inventory-report.ts`):
 * a single pure function turns the live store snapshots into a plain
 * `DashboardSummary` the presentational `<Dashboard>` renders. No DOM, no Dexie,
 * no `fetch` — portable + unit-tested. The component does the `useMemo` over this
 * builder and the readings `liveQuery` for sparklines (which live outside the
 * pure layer, since the fermenter↔batch link is still best-effort).
 */

import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import { isLowStock } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { BrewSystem, Cooler, Fermenter, FermStatus } from '@/stores/system-store'
import { abv as calcAbv, progressPct as calcProgress } from '@/stores/system-store'

export interface DashboardKpis {
  recipeCount: number
  activeBatchCount: number
  vesselsFermentingCount: number
  lowStockCount: number
}

export interface BrewhouseStatus {
  brewing: boolean
  chilling: boolean
  glycol: boolean
  fermentingCount: number
  vesselCount: number
}

export interface ActiveFermentation {
  fermenterId: string
  name: string
  status: FermStatus
  statusLabel: string
  og: number | null
  sg: number | null
  fg: number | null
  dayN: number | null
  progressPct: number | null
  abv: number | null
  /** The readings-sparkline source: the real `Fermenter.batchId` link when
   *  stamped (guided brew → fermenting), else the best-effort in-progress-batch
   *  match by recipeId. `null` when neither resolves. */
  batchId: string | null
}

export type AttentionTone = 'warn' | 'go' | 'info'
export type AttentionKind = 'low-stock' | 'ready' | 'note'

export interface AttentionItem {
  id: string
  kind: AttentionKind
  tone: AttentionTone
  tag: string
  title: string
  detail: string
  href: string
}

export interface AttentionSection {
  items: AttentionItem[]
  allClear: boolean
}

export interface DashboardSummary {
  kpis: DashboardKpis
  brewhouse: BrewhouseStatus
  activeFermentations: ActiveFermentation[]
  attention: AttentionSection
}

export interface BuildDashboardInput {
  recipes: Recipe[]
  batches: Batch[]
  fermenters: Fermenter[]
  brewSystems: BrewSystem[]
  coolers: Cooler[]
  inventory: InventoryItem[]
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: Date
}

const FERM_LABEL: Record<FermStatus, string> = {
  empty: 'Empty',
  fermenting: 'Fermenting',
  'cold-crash': 'Cold Crash',
  conditioning: 'Conditioning',
  packaged: 'Packaged',
}

/** Whole days since an ISO instant, injected-`now` variant of `daysSince`
 *  (`system-store.ts`) so the aggregator stays deterministic. */
function daysBetween(iso: string | undefined, now: Date): number | null {
  if (!iso) return null
  const ms = now.getTime() - Date.parse(iso)
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 86_400_000) : null
}

/**
 * Ready-to-cold-crash: the `'go'` branch of `fermAlerts` in `system-view.tsx`
 * (fermenting && og,sg,fg present && sg <= fg + 0.002). Replicated purely.
 */
export function isReadyToColdCrash(f: Fermenter): boolean {
  return (
    f.status === 'fermenting' &&
    f.og != null &&
    f.sg != null &&
    f.fg != null &&
    f.sg <= f.fg + 0.002
  )
}

const fermName = (f: Fermenter): string => f.batch || f.recipeName || f.name

/** First non-empty line of some markdown/free text, trimmed + length-capped. */
function firstLine(text: string | undefined, max = 96): string | null {
  if (!text) return null
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return null
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** A one-line recap of a batch's most recent recorded thought, if any. */
function batchNote(b: Batch): string | null {
  const outcome = firstLine(b.outcomeNotes_md)
  if (outcome) return outcome
  const t = b.tasting
  if (t) {
    const tasting = firstLine(
      t.overall_md || t.flavor_md || t.aroma_md || t.appearance_md || t.mouthfeel_md,
    )
    if (tasting) return tasting
  }
  const lastLog = b.logs.at(-1)
  if (lastLog) return `${lastLog.label}: ${lastLog.value}`
  return null
}

export function buildDashboard(input: BuildDashboardInput): DashboardSummary {
  const { recipes, batches, fermenters, brewSystems, coolers, inventory } = input
  const now = input.now ?? new Date()

  const inProgressBatches = batches.filter((b) => b.status === 'in-progress')
  const activeVessels = fermenters.filter((f) => f.status !== 'empty')
  const lowStock = inventory.filter(isLowStock)

  // ---- KPI row ----
  const kpis: DashboardKpis = {
    recipeCount: recipes.length,
    activeBatchCount: inProgressBatches.length,
    vesselsFermentingCount: activeVessels.length,
    lowStockCount: lowStock.length,
  }

  // ---- Brewhouse strip (any-active reductions, mirrors system-view) ----
  const brewhouse: BrewhouseStatus = {
    brewing: brewSystems.some((b) => b.status === 'active'),
    chilling: coolers.some((c) => c.kind === 'counterflow' && c.status === 'active'),
    glycol: coolers.some((c) => c.kind === 'glycol' && c.status === 'active'),
    fermentingCount: activeVessels.length,
    vesselCount: fermenters.length,
  }

  // ---- Active fermentations ----
  const activeFermentations: ActiveFermentation[] = activeVessels.map((f) => ({
    fermenterId: f.id,
    name: fermName(f),
    status: f.status,
    statusLabel: FERM_LABEL[f.status],
    og: f.og ?? null,
    sg: f.sg ?? null,
    fg: f.fg ?? null,
    dayN: daysBetween(f.pitchedAt, now),
    progressPct: calcProgress(f.og, f.sg, f.fg),
    abv: calcAbv(f.og, f.sg),
    // Prefer the real fermenter↔batch link (stamped at the fermenting transition);
    // fall back to the recipeId heuristic for un-stamped / legacy fermenters.
    batchId:
      f.batchId ??
      (f.recipeId ? (inProgressBatches.find((b) => b.recipeId === f.recipeId)?.id ?? null) : null),
  }))

  // ---- Attention ----
  const items: AttentionItem[] = []

  if (lowStock.length > 0) {
    const names = lowStock.map((i) => i.name)
    const shown = names.slice(0, 3).join(' · ')
    const extra = names.length > 3 ? ` +${names.length - 3} more` : ''
    items.push({
      id: 'low-stock',
      kind: 'low-stock',
      tone: 'warn',
      tag: 'Low stock',
      title: `${lowStock.length} ${lowStock.length === 1 ? 'ingredient' : 'ingredients'} low`,
      detail: `${shown}${extra}`,
      href: '/inventory',
    })
  }

  for (const f of fermenters) {
    if (isReadyToColdCrash(f)) {
      items.push({
        id: `ready-${f.id}`,
        kind: 'ready',
        tone: 'go',
        tag: 'Ready',
        title: fermName(f),
        detail: 'At FG — ready to cold-crash',
        href: '/system',
      })
    }
  }

  // Recent notes: newest batches first, up to 2 that carry a recorded thought.
  const byRecent = [...batches].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  let noteCount = 0
  for (const b of byRecent) {
    if (noteCount >= 2) break
    const note = batchNote(b)
    if (!note) continue
    items.push({
      id: `note-${b.id}`,
      kind: 'note',
      tone: 'info',
      tag: 'Note',
      title: b.name || `Batch #${b.batchNo}`,
      detail: note,
      href: '/logbook',
    })
    noteCount++
  }

  return {
    kpis,
    brewhouse,
    activeFermentations,
    attention: { items, allClear: items.length === 0 },
  }
}
