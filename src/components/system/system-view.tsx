'use client'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { FermentationChart } from '@/components/charts/fermentation-chart'
import { useBatchReadings } from '@/hooks/use-batch-readings'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { useRecipesStore } from '@/stores/recipes-store'
import { useSessionStore } from '@/stores/session-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
  abv,
  attenuation,
  type BrewSystem,
  type Cooler,
  type CoolerKind,
  daysSince,
  type Fermenter,
  type FermStatus,
  progressPct,
  useSystemStore,
} from '@/stores/system-store'
import { BrewStartGate } from './brew-start-gate'
import { EquipmentRow } from './equipment-row'
import { RefractometerHelper } from './refractometer-helper'

// Each fermenter carries a signature accent color, assigned BY INDEX so that
// user-added vessels beyond the original four still light up a `--fc` rail.
const FERM_COLORS = [
  'hsl(36 92% 58%)', // amber
  'hsl(172 68% 48%)', // teal
  'hsl(266 72% 66%)', // violet
  'hsl(342 80% 63%)', // rose
]
const fermColor = (i: number): string => FERM_COLORS[i % FERM_COLORS.length]

const FERM_LABEL: Record<FermStatus, string> = {
  empty: 'Empty',
  fermenting: 'Fermenting',
  'cold-crash': 'Cold Crash',
  conditioning: 'Conditioning',
  packaged: 'Packaged',
}

const STAGE_LABEL: Record<string, string> = {
  prep: 'Stage 0 · Prep',
  hotside: 'Stage 1 · Hot Side',
  fermentation: 'Stage 2 · Fermentation',
  packaging: 'Stage 3 · Packaging',
  conditioning: 'Stage 4 · Conditioning',
}

type Alert = { tone: 'warn' | 'go' | 'info'; text: string }

function fermAlerts(f: Fermenter): Alert[] {
  if (f.status === 'empty') return []
  const out: Alert[] = []
  if (f.tempCurrent != null && f.tempTarget != null) {
    const d = f.tempCurrent - f.tempTarget
    if (Math.abs(d) > 2)
      out.push({ tone: 'warn', text: `Temp ${d > 0 ? '+' : ''}${d.toFixed(0)}° off target` })
  }
  if (f.status === 'fermenting') {
    if (f.og == null || f.sg == null) out.push({ tone: 'info', text: 'Log a gravity reading' })
    else if (f.fg != null && f.sg <= f.fg + 0.002)
      out.push({ tone: 'go', text: 'At FG — ready to cold-crash' })
  }
  return out
}

const numOrU = (v: string): number | undefined => (v === '' ? undefined : Number(v))

// A comma-separated component list committed on blur (raw buffer avoids the
// controlled-input cursor fight that split/join-on-keystroke would cause).
const parseComponents = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function SystemView() {
  const [mounted, setMounted] = useState(false)
  const {
    brewSystems,
    coolers,
    fermenters,
    currentBrew,
    addBrewSystem,
    removeBrewSystem,
    patchBrewSystem,
    cycleBrewSystem,
    addCooler,
    removeCooler,
    patchCooler,
    cycleCooler,
    addFermenter,
    removeFermenter,
    cycleFermenter,
    patchFermenter,
    reset,
  } = useSystemStore()
  const { recipes } = useRecipesStore()
  const router = useRouter()
  const { session, loadActive } = useSessionStore()
  const running = session?.lifecycle === 'running' || session?.lifecycle === 'paused'
  const [showGate, setShowGate] = useState(false)
  const [newCoolerKind, setNewCoolerKind] = useState<CoolerKind>('counterflow')
  // Single-expand accordion: only one fermenter row is open at a time.
  const [expandedFerm, setExpandedFerm] = useState<string | null>(null)

  useEffect(() => setMounted(true), [])
  // Hydrate the active-session pointer on /system. loadActive() is idempotent and
  // its ref is store-stable, so this runs once: it adopts a genuinely running|paused
  // session (so its ribbon survives a full reload) and clears a stale done/aborted
  // pointer (session + activeId → null, persisted null). Mirrors the loadActive()
  // call in guided-runner.tsx so /system agrees with the runner after a reload.
  useEffect(() => {
    void loadActive()
  }, [loadActive])

  if (!mounted) {
    return <div className="h-[60vh] animate-pulse rounded-xl border border-border bg-card/40" />
  }

  // Derive the top status strip from ANY-active reductions over the arrays.
  const brewOn = brewSystems.some((b) => b.status === 'active')
  const wortOn = coolers.some((c) => c.kind === 'counterflow' && c.status === 'active')
  const coolerOn = coolers.some((c) => c.kind === 'glycol' && c.status === 'active')
  const anyFermenting = fermenters.some((f) => f.status !== 'empty')

  const allAlerts = fermenters.flatMap((f) =>
    fermAlerts(f).map((a) => ({ ...a, who: f.batch || f.recipeName || f.name })),
  )

  const removeFerm = (f: Fermenter) => {
    const label = f.batch || f.recipeName || f.name
    if (f.status !== 'empty' && !window.confirm(`Remove ${label}? This clears its live data.`))
      return
    removeFermenter(f.id)
  }
  const removeSystem = (b: BrewSystem) => {
    if (window.confirm(`Remove ${b.name}?`)) removeBrewSystem(b.id)
  }
  const removeChiller = (c: Cooler) => {
    if (window.confirm(`Remove ${c.name}?`)) removeCooler(c.id)
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-6">
        <div>
          <span className="eyebrow">⚙️ Rig Status</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Brew Flow</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your configurable brewing rig — add the brew systems, chillers, and fermenters you
            actually own. Expand any row for live status, vitals, and fermentation progress.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (
              !anyFermenting ||
              window.confirm('Reset the board? This clears all live fermentation data.')
            ) {
              reset()
            }
          }}
          className="btn-ghost danger"
        >
          Reset board
        </button>
      </header>

      {running && session ? (
        <div className="gs-ribbon">
          <span>
            {session.lifecycle === 'paused'
              ? `⏸ Paused — ${session.recipeName ?? 'brew'}`
              : `🟢 Guided session in progress — ${session.recipeName ?? 'brew'}`}
          </span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => router.push(`/system/run/?session=${session.id}`)}
          >
            Return to runner →
          </button>
        </div>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setShowGate(true)}>
          🍺 Start a brew
        </button>
      )}

      {running && session && (
        <div className="gs-resume">
          <span>
            Resume — {STAGE_LABEL[session.stageId] ?? session.stageId} ·{' '}
            {session.cursor.replace(/-/g, ' ')}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.push(`/system/run/?session=${session.id}`)}
          >
            Open
          </button>
        </div>
      )}

      {/* Process stepper — derived from any-active over the arrays */}
      <div className="stepper">
        <Step n={1} label="Brew" on={brewOn} />
        <span className="step-arrow">→</span>
        <Step n={2} label="Chill Wort" on={wortOn || coolerOn} />
        <span className="step-arrow">→</span>
        <Step n={3} label="Ferment" on={anyFermenting} />
      </div>

      {/* Status banner + live alerts */}
      <StatusBanner brewOn={brewOn} wortOn={wortOn} coolerOn={coolerOn} alerts={allAlerts} />

      <div className="eq-sections">
        <Section
          title="Brew Systems"
          count={brewSystems.length}
          actions={
            <button type="button" className="btn-primary" onClick={addBrewSystem}>
              <span aria-hidden="true">＋</span>
              <span>Add brew system</span>
            </button>
          }
        >
          {brewSystems.length === 0 ? (
            <EmptyHint text="No brew systems yet — add your kettle / all-in-one." />
          ) : (
            brewSystems.map((b) => (
              <MachineRow
                key={b.id}
                glyph="🫧"
                name={b.name}
                model={b.model}
                components={b.components}
                on={b.status === 'active'}
                onLabel="Brewing"
                offLabel="Standby"
                panelLabel={`${b.name} settings`}
                extra={
                  b.status === 'active' && currentBrew ? (
                    <div className="brew-water-summary">
                      {currentBrew.recipeName && (
                        <span className="bw-recipe">{currentBrew.recipeName}</span>
                      )}
                      <span className="bw-add">
                        {currentBrew.skipped
                          ? 'water: skipped'
                          : currentBrew.additionsSummary || 'water set'}
                      </span>
                    </div>
                  ) : null
                }
                onCycle={() => cycleBrewSystem(b.id)}
                onRemove={() => removeSystem(b)}
                onRename={(v) => patchBrewSystem(b.id, { name: v })}
                onRemodel={(v) => patchBrewSystem(b.id, { model: v || undefined })}
                onComponents={(raw) => patchBrewSystem(b.id, { components: parseComponents(raw) })}
              />
            ))
          )}
        </Section>

        <Section
          title="Chillers & Coolers"
          count={coolers.length}
          actions={
            <div className="eq-section-actions">
              <select
                aria-label="New cooler type"
                className="field"
                value={newCoolerKind}
                onChange={(e) => setNewCoolerKind(e.target.value as CoolerKind)}
              >
                <option value="counterflow">Counterflow</option>
                <option value="glycol">Glycol</option>
              </select>
              <button
                type="button"
                className="btn-primary"
                onClick={() => addCooler(newCoolerKind)}
              >
                <span aria-hidden="true">＋</span>
                <span>Add cooler</span>
              </button>
            </div>
          }
        >
          {coolers.length === 0 ? (
            <EmptyHint text="No chillers yet — add a counterflow or glycol cooler." />
          ) : (
            coolers.map((c) => (
              <MachineRow
                key={c.id}
                glyph={c.kind === 'glycol' ? '❄️' : '🌀'}
                name={c.name}
                model={c.model}
                components={c.components}
                on={c.status === 'active'}
                onLabel={c.kind === 'glycol' ? 'Chilling' : 'Cooling Wort'}
                offLabel="Standby"
                panelLabel={`${c.name} settings`}
                kindSelect={
                  <label className="eq-field">
                    <span className="eq-field-label">Type</span>
                    <select
                      aria-label={`${c.name} type`}
                      className="field"
                      value={c.kind}
                      onChange={(e) => patchCooler(c.id, { kind: e.target.value as CoolerKind })}
                    >
                      <option value="counterflow">Counterflow</option>
                      <option value="glycol">Glycol</option>
                    </select>
                  </label>
                }
                onCycle={() => cycleCooler(c.id)}
                onRemove={() => removeChiller(c)}
                onRename={(v) => patchCooler(c.id, { name: v })}
                onRemodel={(v) => patchCooler(c.id, { model: v || undefined })}
                onComponents={(raw) => patchCooler(c.id, { components: parseComponents(raw) })}
              />
            ))
          )}
        </Section>

        <Section
          title="Fermenters"
          count={fermenters.length}
          gridClassName={expandedFerm ? 'has-open' : ''}
          actions={
            <button type="button" className="btn-primary" onClick={addFermenter}>
              <span aria-hidden="true">＋</span>
              <span>Add fermenter</span>
            </button>
          }
        >
          {fermenters.length === 0 ? (
            <EmptyHint text="No fermenters yet — add a vessel to track a batch." />
          ) : (
            fermenters.map((f, i) => (
              <FermenterRow
                key={f.id}
                ferm={f}
                color={fermColor(i)}
                recipes={recipes}
                expanded={expandedFerm === f.id}
                onToggle={() => setExpandedFerm((cur) => (cur === f.id ? null : f.id))}
                onCycle={() => cycleFermenter(f.id)}
                onRemove={() => removeFerm(f)}
                patch={(p) => patchFermenter(f.id, p)}
              />
            ))
          )}
        </Section>
      </div>

      {showGate && <BrewStartGate onClose={() => setShowGate(false)} />}
    </div>
  )
}

function Section({
  title,
  count,
  actions,
  gridClassName,
  children,
}: {
  title: string
  count: number
  actions: ReactNode
  gridClassName?: string
  children: ReactNode
}) {
  return (
    <section className="ferm-system eq-section">
      <div className="ferm-system-head">
        <div className="eq-section-heading">
          <span className="ferm-system-title">{title}</span>
          <span className="eq-section-count">{count}</span>
        </div>
        {actions}
      </div>
      <div className={`ferm-grid${gridClassName ? ` ${gridClassName}` : ''}`}>{children}</div>
    </section>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="eq-empty text-sm text-muted-foreground">{text}</p>
}

function Step({ n, label, on }: { n: number; label: string; on: boolean }) {
  return (
    <span className={`step ${on ? 'on' : ''}`}>
      <span className="step-num">{n}</span>
      {label}
    </span>
  )
}

function StatusBanner({
  brewOn,
  wortOn,
  coolerOn,
  alerts,
}: {
  brewOn: boolean
  wortOn: boolean
  coolerOn: boolean
  alerts: (Alert & { who: string })[]
}) {
  const warns = alerts.filter((a) => a.tone === 'warn')
  return (
    <div className="banner">
      <div className="banner-indicators">
        <BannerChip on={brewOn} icon="🔥" label="Brewing" />
        <BannerChip on={wortOn} icon="🌀" label="Chilling wort" />
        <BannerChip on={coolerOn} icon="❄️" label="Glycol cooling" />
      </div>
      <div className="banner-alarms">
        {alerts.length === 0 ? (
          <span className="banner-ok">✓ All nominal</span>
        ) : (
          <>
            <span className={`banner-count ${warns.length ? 'warn' : ''}`}>
              {alerts.length} {alerts.length === 1 ? 'flag' : 'flags'}
            </span>
            {alerts.slice(0, 3).map((a) => (
              <span key={`${a.who}-${a.text}`} className={`banner-alert ${a.tone}`}>
                <b>{a.who}:</b> {a.text}
              </span>
            ))}
          </>
        )}
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

/** Brew-system / cooler row — the simpler machine detail (status toggle, rename,
 *  model, components; coolers also get a kind select). */
function MachineRow({
  glyph,
  name,
  model,
  components,
  on,
  onLabel,
  offLabel,
  panelLabel,
  extra,
  kindSelect,
  onCycle,
  onRemove,
  onRename,
  onRemodel,
  onComponents,
}: {
  glyph: string
  name: string
  model?: string
  components: string[]
  on: boolean
  onLabel: string
  offLabel: string
  panelLabel: string
  extra?: ReactNode
  kindSelect?: ReactNode
  onCycle: () => void
  onRemove: () => void
  onRename: (v: string) => void
  onRemodel: (v: string) => void
  onComponents: (raw: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = (
    <>
      <span className="ferm-dot" />
      <span className="eq-namecol">
        <span className="ferm-name">
          <span aria-hidden="true">{glyph}</span> {name}
        </span>
        {model && <span className="eq-sub">{model}</span>}
      </span>
      <span className="eq-summary-right">
        {components.length > 0 && (
          <span className="chip-row eq-chips" aria-hidden="true">
            {components.map((c) => (
              <span key={c} className="flow-chip">
                {c}
              </span>
            ))}
          </span>
        )}
        <span className="ferm-row-pill ferm-state">{on ? onLabel : offLabel}</span>
      </span>
    </>
  )

  return (
    <EquipmentRow
      color="var(--primary)"
      on={on}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      panelLabel={panelLabel}
      summary={summary}
      deleteLabel={`Remove ${name}`}
      onDelete={onRemove}
    >
      <div className="eq-detail-grid">
        <label className="eq-field">
          <span className="eq-field-label">Name</span>
          <input
            className="field"
            value={name}
            aria-label={`${name} name`}
            onChange={(e) => onRename(e.target.value)}
          />
        </label>
        <label className="eq-field">
          <span className="eq-field-label">Model</span>
          <input
            className="field"
            value={model ?? ''}
            placeholder="e.g. Brewtools B40pro"
            aria-label={`${name} model`}
            onChange={(e) => onRemodel(e.target.value)}
          />
        </label>
        {kindSelect}
        <label className="eq-field eq-field-wide">
          <span className="eq-field-label">Components (comma-separated)</span>
          <input
            key={components.join('|')}
            className="field"
            defaultValue={components.join(', ')}
            placeholder="Steam Hat, Recirc Pump"
            aria-label={`${name} components`}
            onBlur={(e) => onComponents(e.target.value)}
          />
        </label>
      </div>

      {extra}

      <button type="button" className="ferm-advance" onClick={onCycle}>
        <span className="ferm-state">{on ? onLabel : offLabel}</span>
        <span className="advance-hint">toggle ▸</span>
      </button>
    </EquipmentRow>
  )
}

/** Compact dual-line fermentation curve for the expanded row. Shows a hint when
 *  the fermenter has no linked batch. */
function FermRowChart({ batchId }: { batchId?: string }) {
  const readings = useBatchReadings(batchId)
  const { settings } = useSettingsStore()
  const units = settings?.units ?? 'metric'

  if (!batchId) {
    return <p className="ferment-chart-empty">Link a batch to see the fermentation curve.</p>
  }
  return (
    <div className="trend-card ferment-chart-card ferm-row-chart">
      <FermentationChart readings={readings} units={units} />
    </div>
  )
}

function FermenterRow({
  ferm,
  color,
  recipes,
  expanded,
  onToggle,
  onCycle,
  onRemove,
  patch,
}: {
  ferm: Fermenter
  color: string
  recipes: Recipe[]
  expanded: boolean
  onToggle: () => void
  onCycle: () => void
  onRemove: () => void
  patch: (p: Partial<Fermenter>) => void
}) {
  const on = ferm.status !== 'empty'
  const brewing = ferm.status === 'fermenting'
  const days = daysSince(ferm.pitchedAt)
  const a = abv(ferm.og, ferm.sg)
  const att = attenuation(ferm.og, ferm.sg)
  const prog = progressPct(ferm.og, ferm.sg, ferm.fg)
  const alerts = fermAlerts(ferm)
  const flag = alerts[0]
  const name = ferm.batch || ferm.recipeName || ferm.name

  const linkRecipe = (id: string) => {
    if (!id) {
      patch({ recipeId: undefined, recipeName: undefined })
      return
    }
    const r = recipes.find((x) => x.id === id)
    if (!r) return
    patch({
      recipeId: r.id,
      recipeName: r.name,
      fg: r.targets?.FG ?? ferm.fg,
      og: ferm.og ?? r.targets?.OG,
      batch: ferm.batch || r.name,
    })
  }

  const summary = (
    <>
      <span className="ferm-dot" />
      <span className="ferm-name">{name}</span>
      {days != null && <span className="day-badge">Day {days}</span>}
      <span className="ferm-state ferm-row-pill">{FERM_LABEL[ferm.status]}</span>
      <span className="ferm-row-metrics" aria-hidden="true">
        {ferm.sg != null && (
          <span className="frm">
            <span className="frm-k">SG</span>
            {ferm.sg.toFixed(3)}
          </span>
        )}
        {(ferm.tempCurrent != null || ferm.tempTarget != null) && (
          <span className="frm">
            <span className="frm-k">°F</span>
            {ferm.tempCurrent ?? '—'}/{ferm.tempTarget ?? '—'}
          </span>
        )}
        {prog != null && (
          <span className="ferm-row-bar">
            <span className="fill" style={{ width: `${prog}%` }} />
          </span>
        )}
        {prog != null && <span className="frm frm-pct">{prog.toFixed(0)}%</span>}
      </span>
      {flag && <span className={`mini-alert ${flag.tone} ferm-row-flag`}>{flag.text}</span>}
    </>
  )

  return (
    <EquipmentRow
      color={color}
      on={on}
      brewing={brewing}
      hasAlert={alerts.length > 0}
      expanded={expanded}
      onToggle={onToggle}
      panelLabel={`${name} controls`}
      summary={summary}
      deleteLabel={`Remove ${ferm.name}`}
      onDelete={onRemove}
    >
      {/* Vessel name — renames the fermenter itself (e.g. "Fermenter 1" →
          "Conical #1"). Mirrors the EquipmentRow rename input; trims and skips
          the patch on an empty/whitespace-only value so the vessel is never
          wiped blank. Distinct from the collapsed summary's batch||recipe||name. */}
      <label className="eq-field">
        <span className="eq-field-label">Name</span>
        <input
          className="field"
          value={ferm.name}
          aria-label="Fermenter name"
          onChange={(e) => {
            const v = e.target.value
            if (v.trim()) patch({ name: v })
          }}
        />
      </label>

      {recipes.length > 0 && (
        <select
          className="ferm-recipe"
          value={ferm.recipeId ?? ''}
          onChange={(e) => linkRecipe(e.target.value)}
        >
          <option value="">— link recipe —</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}

      <div className="ferm-vitals">
        <label className="vital">
          <span className="vital-label">Temp °F</span>
          <span className="vital-pair">
            <input
              type="number"
              value={ferm.tempCurrent ?? ''}
              placeholder="cur"
              aria-label="Current temperature"
              onChange={(e) => patch({ tempCurrent: numOrU(e.target.value) })}
            />
            <span>/</span>
            <input
              type="number"
              value={ferm.tempTarget ?? ''}
              placeholder="tgt"
              aria-label="Target temperature"
              onChange={(e) => patch({ tempTarget: numOrU(e.target.value) })}
            />
          </span>
        </label>
        <label className="vital">
          <span className="vital-label">Gravity</span>
          <span className="vital-pair">
            <input
              type="number"
              step="0.001"
              value={ferm.og ?? ''}
              placeholder="OG"
              aria-label="Original gravity"
              onChange={(e) => patch({ og: numOrU(e.target.value) })}
            />
            <span>→</span>
            <input
              type="number"
              step="0.001"
              value={ferm.sg ?? ''}
              placeholder="SG"
              aria-label="Current gravity"
              onChange={(e) => patch({ sg: numOrU(e.target.value) })}
            />
          </span>
        </label>
      </div>

      <RefractometerHelper og={ferm.og} onApply={(sg) => patch({ sg, fg: sg })} />

      {prog != null && (
        <div className="ferm-progress">
          <div className="bar">
            <div className="fill" style={{ width: `${prog}%` }} />
          </div>
          <div className="readout">
            <span className="pct">{prog.toFixed(0)}%</span>
            {a != null && <span>{a.toFixed(1)}% ABV</span>}
            {att != null && <span>{att.toFixed(0)}% att</span>}
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="ferm-alerts">
          {alerts.map((al) => (
            <span key={al.text} className={`mini-alert ${al.tone}`}>
              {al.text}
            </span>
          ))}
        </div>
      )}

      <button type="button" className="ferm-advance" onClick={onCycle}>
        <span className="ferm-state">{FERM_LABEL[ferm.status]}</span>
        <span className="advance-hint">advance ▸</span>
      </button>

      <FermRowChart batchId={ferm.batchId} />
    </EquipmentRow>
  )
}
