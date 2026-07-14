'use client'
import { useMemo } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { srmIsDark, srmToHex } from '@/lib/brewing/calc/srm-color'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { calcStepInfusions } from '@/lib/brewing/mash/step-infusions'
import { findStyle } from '@/lib/brewing/styles/bjcp-2021'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { formatGravity } from '@/lib/format/gravity'
import { useEquipmentStore } from '@/stores/equipment-store'
import { useSettingsStore } from '@/stores/settings-store'
import { VitalStat } from './vital-stat'

const fallbackEquipment = B40PRO_PROFILE

export function CalculationPanel() {
  const { control } = useFormContext<Recipe>()
  const recipe = useWatch({ control }) as Recipe
  const { profiles } = useEquipmentStore()
  const { settings } = useSettingsStore()
  const gravityUnit = settings?.gravityUnit ?? 'sg'
  const equipment = profiles.find((p) => p.id === recipe.equipmentProfileId) ?? fallbackEquipment
  const style = recipe.styleId ? findStyle(recipe.styleId) : undefined

  const result = useMemo(() => {
    try {
      return calculateRecipe(recipe, equipment, new Date().toISOString())
    } catch {
      return null
    }
  }, [recipe, equipment])

  if (!result) {
    return <p className="text-sm text-muted-foreground">Fill in the recipe to see calculations.</p>
  }

  const gu = (result.OG - 1) * 1000
  const buGu = gu > 0 ? result.IBU / gu : 0
  const beerHex = srmToHex(result.SRM)
  const grainMass_kg = recipe.fermentables
    .filter((f) => f.usage === 'mash')
    .reduce((a, f) => a + f.amount_kg, 0)
  const stepInfusions = calcStepInfusions(recipe, {
    strikeVolume_L: result.volumes.mashWater_L,
    grainMass_kg,
  }).filter((s) => s.water_L != null)

  return (
    <aside className="calc-panel">
      <div className="calc-head">
        <div>
          <span className="eyebrow">Live calc</span>
          <h2 className="calc-title">Calculations</h2>
        </div>
        <div className="beer-preview" title={`${result.SRM.toFixed(1)} SRM`}>
          <span className="beer-glass" style={{ background: beerHex }}>
            <span className="beer-foam" />
          </span>
          <span className={`beer-srm ${srmIsDark(result.SRM) ? 'on-dark' : ''}`}>
            {result.SRM.toFixed(1)}
            <small>SRM</small>
          </span>
        </div>
      </div>

      <div className="gauge-grid">
        <VitalStat
          label="OG"
          value={formatGravity(result.OG, gravityUnit)}
          target={style?.vitalStats.OG}
          current={result.OG}
        />
        <VitalStat
          label="FG"
          value={formatGravity(result.FG, gravityUnit)}
          target={style?.vitalStats.FG}
          current={result.FG}
        />
        <VitalStat
          label="ABV"
          value={`${result.ABV.toFixed(1)}%`}
          target={style?.vitalStats.ABV}
          current={result.ABV}
        />
        <VitalStat
          label="IBU"
          value={result.IBU.toFixed(0)}
          target={style?.vitalStats.IBU}
          current={result.IBU}
        />
        <VitalStat
          label="SRM"
          value={result.SRM.toFixed(1)}
          target={style?.vitalStats.SRM}
          current={result.SRM}
        />
        <div className="gaugecard is-neutral">
          <div className="gauge-head">
            <span className="gauge-label">BU:GU</span>
            <span className="gauge-value">{buGu.toFixed(2)}</span>
          </div>
          <div className="gauge-foot">
            <span className="gauge-range">bitterness : gravity</span>
          </div>
        </div>
      </div>

      <div className="calc-block">
        <div className="calc-block-title">Volumes (L)</div>
        <dl className="calc-rows">
          <div>
            <dt>Pre-boil</dt>
            <dd>{result.volumes.preBoilVolume_L.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Post-boil</dt>
            <dd>{result.volumes.postBoilVolume_L.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Into fermenter</dt>
            <dd>{result.volumes.intoFermenter_L.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Mash water</dt>
            <dd>{result.volumes.mashWater_L.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Sparge</dt>
            <dd>{result.volumes.spargeWater_L.toFixed(2)}</dd>
          </div>
        </dl>
      </div>

      <div className="calc-block">
        <div className="calc-block-title">Strike temp</div>
        <div className="calc-strike">{result.strikeTemp_C.toFixed(1)} °C</div>
      </div>

      {stepInfusions.length > 0 && (
        <div className="calc-block">
          <div className="calc-block-title">Step infusions (L @ 100 °C)</div>
          <dl className="calc-rows">
            {stepInfusions.map((s) => (
              <div key={s.stepIndex}>
                <dt>{recipe.mashSteps[s.stepIndex]?.name ?? `Step ${s.stepIndex + 1}`}</dt>
                <dd>+{(s.water_L as number).toFixed(2)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </aside>
  )
}
