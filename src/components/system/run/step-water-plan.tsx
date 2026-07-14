'use client'
import type { JSX } from 'react'
import type { WaterPlanResult } from '@/components/system/use-water-plan'
import { useWaterPlan } from '@/components/system/use-water-plan'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { IonProfile, SaltKey } from '@/lib/brewing/water/ions'
import type { WaterStyleKey } from '@/lib/brewing/water/target'
import { so4ClBand } from '@/lib/brewing/water/target'

const SALT_LABEL: Record<SaltKey, string> = {
  gypsum: 'Gypsum (CaSO₄)',
  cacl2: 'Calcium chloride (CaCl₂)',
  epsom: 'Epsom (MgSO₄)',
  nacl: 'Table salt (NaCl)',
  nahco3: 'Baking soda (NaHCO₃)',
}

// Matches the Phase-3 SessionWaterPlan field names exactly.
export interface StepWaterPlanWrite {
  sourceProfileName?: string
  additionsSummary?: string
  skipped?: boolean
  estMashPh?: number
  totalSaltGrams?: number
  lacticAcid_mL?: number
}

export interface StepWaterPlanProps {
  recipe?: Recipe
  equipment: EquipmentProfile
  source: IonProfile
  sourceName: string
  manualStyle: WaterStyleKey
  manualVolume_L: number
  now: string
  onConfirm: (plan: StepWaterPlanWrite) => void
  onSkip: (plan: StepWaterPlanWrite) => void
}

export function toWaterPlanWrite(
  p: WaterPlanResult | null,
  opts: { skipped: boolean },
): StepWaterPlanWrite {
  if (opts.skipped || !p) return { skipped: true }
  // Compute total salt grams as sum of all non-trivial salt additions
  const totalSaltGrams = (Object.values(p.add.grams) as number[]).reduce(
    (sum, g) => sum + (g > 0.05 ? g : 0),
    0,
  )
  return {
    sourceProfileName: p.sourceName,
    additionsSummary: p.summary,
    estMashPh: p.mash?.ph,
    skipped: false,
    totalSaltGrams,
    lacticAcid_mL: p.acid?.lactic88_mL ?? 0,
  }
}

export function StepWaterPlan(props: StepWaterPlanProps): JSX.Element {
  const { recipe, equipment, source, sourceName, manualStyle, manualVolume_L, now } = props
  const calc = useWaterPlan({
    recipe,
    equipment,
    source,
    sourceName,
    manualStyle,
    manualVolume_L,
    now,
  })

  return (
    <div className="water-readout">
      {calc ? (
        <>
          <div className="water-row">
            <b>Target</b>
            <span>
              {calc.styleKey} · for {calc.totalWater_L.toFixed(1)} L total water
            </span>
          </div>
          <div>
            <div className="water-block-title">Salt additions</div>
            <ul className="water-salts">
              {(Object.keys(calc.add.grams) as SaltKey[])
                .filter((k) => calc.add.grams[k] > 0.05)
                .map((k) => (
                  <li key={k}>
                    <span>{SALT_LABEL[k]}</span>
                    <b>{calc.add.grams[k].toFixed(1)} g</b>
                  </li>
                ))}
              {calc.noAdditions && <li>No additions needed.</li>}
            </ul>
          </div>
          <div className="water-row">
            <b>SO₄:Cl</b>
            <span>
              {Number.isFinite(calc.add.so4cl) ? calc.add.so4cl.toFixed(2) : '∞'} : 1 —{' '}
              {so4ClBand(calc.add.so4cl).label}
            </span>
          </div>
          {calc.mash ? (
            <dl className="water-row">
              <dt>Est. mash pH</dt>
              <dd>
                {calc.mash.ph.toFixed(2)} <small>(±0.15 — confirm with a meter)</small>
                {calc.acid && (
                  <>
                    {' '}
                    → add {calc.acid.lactic88_mL.toFixed(1)} mL 88% lactic{' '}
                    <small>or {calc.acid.acidMaltPct.toFixed(1)}% acid malt</small>
                  </>
                )}
              </dd>
            </dl>
          ) : (
            <dl className="water-row">
              <dt>Est. mash pH</dt>
              <dd className="text-muted-foreground">pick a recipe to estimate mash pH</dd>
            </dl>
          )}
          {calc.add.warnings.length > 0 && (
            <div>
              {calc.add.warnings.map((wn) => (
                <div key={wn} className="water-warn">
                  ⚠ {wn}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Enter a total water volume to see the plan.</p>
      )}

      <footer className="water-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => props.onSkip(toWaterPlanWrite(calc, { skipped: true }))}
        >
          I&#x27;ve got my water — skip
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => props.onConfirm(toWaterPlanWrite(calc, { skipped: false }))}
        >
          Confirm &amp; continue
        </button>
      </footer>
    </div>
  )
}
