'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useDisplayUnits } from '@/hooks/use-display-units'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { srmIsDark, srmToHex } from '@/lib/brewing/calc/srm-color'
import {
  formatAmount,
  formatForInput,
  formatWithUnit,
  unitLabel,
} from '@/lib/brewing/convert/display-units'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { calcStepInfusions } from '@/lib/brewing/mash/step-infusions'
import { findStyle } from '@/lib/brewing/styles/bjcp-2021'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Units } from '@/lib/brewing/types/settings'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { formatGravity } from '@/lib/format/gravity'
import { useEquipmentStore } from '@/stores/equipment-store'
import { useSettingsStore } from '@/stores/settings-store'
import { RecipeActions } from './recipe-actions'
import { BrewHistory } from './recipe-brew-history'

export function RecipeDetailView() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') || undefined
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const { profiles } = useEquipmentStore()
  const { settings } = useSettingsStore()
  const gravityUnit = settings?.gravityUnit ?? 'sg'
  const units = useDisplayUnits()

  useEffect(() => {
    if (!id) {
      setStatus('notfound')
      return
    }
    let cancelled = false
    recipeRepo
      .get(id)
      .then((r) => {
        if (cancelled) return
        if (r) {
          setRecipe(r)
          setStatus('ready')
        } else setStatus('notfound')
      })
      .catch(() => {
        if (!cancelled) setStatus('notfound')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const equipment = recipe
    ? (profiles.find((p) => p.id === recipe.equipmentProfileId) ?? B40PRO_PROFILE)
    : B40PRO_PROFILE

  const result = useMemo(() => {
    if (!recipe) return null
    try {
      return calculateRecipe(recipe, equipment, new Date().toISOString())
    } catch {
      return null
    }
  }, [recipe, equipment])

  if (status === 'loading') {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading recipe…</p>
  }
  if (status === 'notfound' || !recipe) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">That recipe could not be found.</p>
        <Link href="/" className="btn-ghost">
          Back to recipes
        </Link>
      </div>
    )
  }

  const style = recipe.styleId ? findStyle(recipe.styleId) : undefined
  const grainMass_kg = recipe.fermentables
    .filter((f) => f.usage === 'mash')
    .reduce((a, f) => a + f.amount_kg, 0)
  const infusions = result
    ? calcStepInfusions(recipe, { strikeVolume_L: result.volumes.mashWater_L, grainMass_kg })
    : []

  return (
    <article className="sheet flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-6">
        <div>
          <span className="eyebrow">🍺 Brew sheet</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{recipe.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {recipe.type.replace('-', ' ')} · {formatForInput(recipe.batchSize_L, 'volume', units)}{' '}
            {unitLabel('volume', units)} · {recipe.boilTime_min} min boil
            {recipe.styleId && (
              <>
                {' · '}
                <span className="font-mono">{recipe.styleId}</span>
              </>
            )}
          </p>
          {recipe.tags && recipe.tags.length > 0 && (
            <div className="chip-row mt-3">
              {recipe.tags.map((tag) => (
                <span key={tag} className="flow-chip">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <RecipeActions recipe={recipe} />
      </header>

      {result && (
        <section className="sheet-stats">
          <SheetStat
            label="OG"
            value={formatGravity(result.OG, gravityUnit)}
            range={style?.vitalStats.OG}
          />
          <SheetStat
            label="FG"
            value={formatGravity(result.FG, gravityUnit)}
            range={style?.vitalStats.FG}
          />
          <SheetStat
            label="ABV"
            value={`${result.ABV.toFixed(1)}%`}
            range={style?.vitalStats.ABV}
          />
          <SheetStat label="IBU" value={result.IBU.toFixed(0)} range={style?.vitalStats.IBU} />
          <SheetStat
            label="SRM"
            value={result.SRM.toFixed(1)}
            range={style?.vitalStats.SRM}
            swatch={srmToHex(result.SRM)}
            dark={srmIsDark(result.SRM)}
          />
        </section>
      )}

      <SheetSection title="Fermentables">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Amount ({unitLabel('mass-grain', units)})</th>
              <th>Use</th>
              <th>Color (°L)</th>
            </tr>
          </thead>
          <tbody>
            {recipe.fermentables.map((f) => (
              <tr key={`${f.ingredientId}:${f.snapshot.name}:${f.usage}:${f.amount_kg}`}>
                <td>{f.snapshot.name}</td>
                <td>{formatAmount(f.amount_kg, 'mass-grain', units)}</td>
                <td>{f.usage}</td>
                <td>{f.snapshot.color_L}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SheetSection>

      <SheetSection title="Hops">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Amount ({unitLabel('mass-hop', units)})</th>
              <th>AA%</th>
              <th>Use</th>
              <th>Time (min)</th>
            </tr>
          </thead>
          <tbody>
            {recipe.hops.map((h) => (
              <tr key={`${h.ingredientId}:${h.snapshot.name}:${h.use}:${h.time_min}:${h.amount_g}`}>
                <td>{h.snapshot.name}</td>
                <td>{formatAmount(h.amount_g, 'mass-hop', units)}</td>
                <td>{h.snapshot.alphaAcid_pct}</td>
                <td>{h.use}</td>
                <td>{h.time_min}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SheetSection>

      <SheetSection title="Mash">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Type</th>
              <th>Temp ({unitLabel('temp', units)})</th>
              <th>Time (min)</th>
              <th>Infusion water</th>
            </tr>
          </thead>
          <tbody>
            {recipe.mashSteps.map((s, i) => {
              const inf = infusions[i]?.water_L
              return (
                <tr key={`${s.name}:${s.type}:${s.temperature_C}:${s.time_min}`}>
                  <td>{s.name}</td>
                  <td>{s.type}</td>
                  <td>{formatForInput(s.temperature_C, 'temp', units)}</td>
                  <td>{s.time_min}</td>
                  <td>
                    {inf != null
                      ? `+${formatAmount(inf, 'volume', units, 1)} ${unitLabel('volume', units)} @ ${formatWithUnit(100, 'temp', units, 0)}`
                      : i === 0
                        ? 'strike'
                        : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </SheetSection>

      {recipe.yeasts.length > 0 && (
        <SheetSection title="Yeast">
          <ul className="sheet-list">
            {recipe.yeasts.map((y) => (
              <li key={`${y.ingredientId}:${y.snapshot.name}`}>
                {y.snapshot.name} — {y.snapshot.attenuation_min_pct}–
                {y.snapshot.attenuation_max_pct}% att ({y.snapshot.form})
              </li>
            ))}
          </ul>
        </SheetSection>
      )}

      {recipe.miscs.length > 0 && (
        <SheetSection title="Miscs">
          <ul className="sheet-list">
            {recipe.miscs.map((m) => (
              <li key={`${m.ingredientId}:${m.snapshot.name}:${m.use}:${m.time_min}`}>
                {m.snapshot.name} — {m.amount} {m.amountUnit} @ {m.use} ({m.time_min} min)
              </li>
            ))}
          </ul>
        </SheetSection>
      )}

      {result && (
        <SheetSection title={`Volumes (${unitLabel('volume', units)})`}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Target</th>
                <th>Actual</th>
              </tr>
            </thead>
            <tbody>
              <VolRow label="Mash water" v={result.volumes.mashWater_L} units={units} />
              <VolRow label="Sparge" v={result.volumes.spargeWater_L} units={units} />
              <VolRow label="Pre-boil" v={result.volumes.preBoilVolume_L} units={units} />
              <VolRow label="Post-boil" v={result.volumes.postBoilVolume_L} units={units} />
              <VolRow label="Into fermenter" v={result.volumes.intoFermenter_L} units={units} />
              <tr>
                <td>Strike temp</td>
                <td>{formatWithUnit(result.strikeTemp_C, 'temp', units, 1)}</td>
                <td className="sheet-actual" />
              </tr>
            </tbody>
          </table>
        </SheetSection>
      )}

      {recipe.notes_md.trim() && (
        <SheetSection title="Notes">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{recipe.notes_md}</p>
        </SheetSection>
      )}

      <SheetSection title="Brew history">
        <BrewHistory recipe={recipe} />
      </SheetSection>
    </article>
  )
}

function SheetStat({
  label,
  value,
  range,
  swatch,
  dark,
}: {
  label: string
  value: string
  range?: [number, number]
  swatch?: string
  dark?: boolean
}) {
  return (
    <div className="sheet-stat">
      <div className="sheet-stat-label">{label}</div>
      <div className="sheet-stat-value">
        {swatch && (
          <span
            className={`sheet-swatch ${dark ? 'on-dark' : ''}`}
            style={{ background: swatch }}
            aria-hidden="true"
          />
        )}
        {value}
      </div>
      {range && (
        <div className="sheet-stat-range">
          {range[0]}–{range[1]}
        </div>
      )}
    </div>
  )
}

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function VolRow({ label, v, units }: { label: string; v: number; units: Units }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{formatAmount(v, 'volume', units)}</td>
      <td className="sheet-actual" />
    </tr>
  )
}
