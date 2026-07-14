'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FermentationChart } from '@/components/charts/fermentation-chart'
import { useBatchReadings } from '@/hooks/use-batch-readings'
import {
  type ActiveFermentation,
  type AttentionItem,
  type BrewhouseStatus,
  buildDashboard,
  type DashboardKpis,
} from '@/lib/brewing/dashboard/build-dashboard'
import { useBatchesStore } from '@/stores/batches-store'
import { useInventoryStore } from '@/stores/inventory-store'
import { useRecipesStore } from '@/stores/recipes-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useSystemStore } from '@/stores/system-store'

/**
 * Recipes-Home dashboard band. Reads the live stores, folds them through the
 * pure `buildDashboard`, and renders KPIs + brewhouse status + active
 * fermentations + attention. Injected at the top of `RecipeListView` for every
 * non-loading state — above both the recipe grid and the empty state — so a
 * fresh, zero-recipe app still shows the "brewhouse at a glance".
 */
export function Dashboard() {
  const { recipes } = useRecipesStore()
  const { batches } = useBatchesStore()
  const { items: inventory } = useInventoryStore()
  const { fermenters, brewSystems, coolers } = useSystemStore()

  // The system store is `persist`ed to localStorage; gate the band until after
  // mount so the SSR/first-client render (default board) can't hydration-mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const summary = useMemo(
    () => buildDashboard({ recipes, batches, fermenters, brewSystems, coolers, inventory }),
    [recipes, batches, fermenters, brewSystems, coolers, inventory],
  )

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="h-40 rounded-xl border border-border bg-card/40 animate-pulse"
      />
    )
  }

  return (
    <section aria-label="Brewery dashboard" className="flex flex-col gap-5">
      <KpiRow kpis={summary.kpis} />
      <BrewhouseStrip brewhouse={summary.brewhouse} />
      <ActiveFermentations items={summary.activeFermentations} />
      <Attention items={summary.attention.items} allClear={summary.attention.allClear} />
    </section>
  )
}

function KpiRow({ kpis }: { kpis: DashboardKpis }) {
  const tiles: { num: number; lbl: string }[] = [
    { num: kpis.recipeCount, lbl: 'Recipes' },
    { num: kpis.activeBatchCount, lbl: 'Active batches' },
    { num: kpis.vesselsFermentingCount, lbl: 'Fermenting' },
    { num: kpis.lowStockCount, lbl: 'Low stock' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.lbl} className="stat-tile">
          <span className="num">{t.num}</span>
          <span className="lbl">{t.lbl}</span>
        </div>
      ))}
    </div>
  )
}

function BrewhouseStrip({ brewhouse }: { brewhouse: BrewhouseStatus }) {
  const { brewing, chilling, glycol, fermentingCount, vesselCount } = brewhouse
  return (
    <div className="banner">
      <div className="banner-indicators">
        <BannerChip on={brewing} icon="🔥" label="Brewing" />
        <BannerChip on={chilling} icon="🌀" label="Chilling" />
        <BannerChip on={glycol} icon="❄️" label="Glycol" />
      </div>
      <div className="banner-alarms">
        <span className="banner-count">
          {fermentingCount} fermenting · {vesselCount} {vesselCount === 1 ? 'vessel' : 'vessels'}
        </span>
      </div>
    </div>
  )
}

function BannerChip({ on, icon, label }: { on: boolean; icon: string; label: string }) {
  return (
    <span className={`banner-chip ${on ? 'on' : ''}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  )
}

function ActiveFermentations({ items }: { items: ActiveFermentation[] }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="eyebrow">🫧 Active fermentations</span>
      {items.length === 0 ? (
        // Zero-state: a subtle, guiding hint instead of a hidden section, so a
        // fresh brewhouse still tells the user where live gravity curves appear.
        <Link
          href="/system"
          className="banner text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden="true">🫙</span>
            No active fermentations — start a brew to see live gravity curves here
          </span>
          <span className="banner-count">System →</span>
        </Link>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((af) => (
            <ActiveFermentationCard key={af.fermenterId} af={af} />
          ))}
        </div>
      )}
    </div>
  )
}

function ActiveFermentationCard({ af }: { af: ActiveFermentation }) {
  const readings = useBatchReadings(af.batchId)
  const { settings } = useSettingsStore()
  const units = settings?.units ?? 'metric'

  return (
    <article
      className="tap-card flex flex-col gap-2 p-4"
      style={{ ['--fc' as string]: 'var(--malt, var(--primary))' }}
    >
      <div className="flex items-center gap-2">
        <span className="ferm-name">{af.name}</span>
        {af.dayN != null && <span className="day-badge">Day {af.dayN}</span>}
      </div>
      <div className="ferm-row-metrics">
        <span className="ferm-state ferm-row-pill">{af.statusLabel}</span>
        {af.sg != null && (
          <span className="frm">
            <span className="frm-k">SG</span>
            {af.sg.toFixed(3)}
          </span>
        )}
        {af.abv != null && (
          <span className="frm">
            <span className="frm-k">ABV</span>
            {af.abv.toFixed(1)}%
          </span>
        )}
        {af.progressPct != null && (
          <>
            <span className="ferm-row-bar">
              <span className="fill" style={{ width: `${af.progressPct}%` }} />
            </span>
            <span className="frm frm-pct">{af.progressPct.toFixed(0)}%</span>
          </>
        )}
      </div>
      {af.batchId ? (
        <FermentationChart readings={readings} units={units} height={140} />
      ) : (
        <p className="text-xs text-muted-foreground">Link a batch to chart gravity.</p>
      )}
    </article>
  )
}

function Attention({ items, allClear }: { items: AttentionItem[]; allClear: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="eyebrow">🔔 Needs attention</span>
      {allClear ? (
        <div className="banner">
          <span className="banner-ok">✓ All clear</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link key={item.id} href={item.href} className="tap-card flex flex-col gap-1.5 p-4">
              <span className={`mini-alert ${item.tone} self-start`}>{item.tag}</span>
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground">{item.detail}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
