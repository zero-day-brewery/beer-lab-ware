'use client'
import { TestTube } from 'lucide-react'
import { useState } from 'react'
import { calcABV } from '@/lib/brewing/calc/abv'
import { brixToSG, roundSG } from '@/lib/brewing/convert/gravity'
import { correctedFG } from '@/lib/brewing/convert/refractometer'
import { formatGravity } from '@/lib/format/gravity'
import { useSettingsStore } from '@/stores/settings-store'
import { CalcCard, CalcField, CalcInputs, CalcOutput, CalcOutputs, DASH } from './calc-card'

/**
 * Refractometer FG correction (Sean Terrill cubic). Lifts the logic from
 * `system/refractometer-helper.tsx` but reads BOTH gravities as °Brix per the
 * calculators spec: convert each via `brixToSG`, run `correctedFG`, round the
 * result. FG renders in the user's gravity unit (SG or Plato).
 */
export function RefractometerCard() {
  const { settings } = useSettingsStore()
  const gravityUnit = settings?.gravityUnit ?? 'sg'

  const [ogBrixStr, setOgBrixStr] = useState('12')
  const [fgBrixStr, setFgBrixStr] = useState('6')

  const ogBrix = Number(ogBrixStr)
  const fgBrix = Number(fgBrixStr)
  const valid = Number.isFinite(ogBrix) && ogBrix > 0 && Number.isFinite(fgBrix) && fgBrix > 0

  const ogSG = valid ? brixToSG(ogBrix) : null
  const fg = valid ? roundSG(correctedFG(brixToSG(ogBrix), brixToSG(fgBrix))) : null
  const abv = ogSG != null && fg != null ? calcABV(ogSG, fg, 'simple') : null

  return (
    <CalcCard
      icon={<TestTube size={18} aria-hidden="true" />}
      title="Refractometer FG"
      caption="Sean Terrill cubic correction"
    >
      <CalcInputs>
        <CalcField
          label="OG °Bx"
          type="number"
          step="0.1"
          min="0"
          value={ogBrixStr}
          placeholder="12"
          onChange={(e) => setOgBrixStr(e.target.value)}
        />
        <CalcField
          label="FG °Bx"
          type="number"
          step="0.1"
          min="0"
          value={fgBrixStr}
          placeholder="6"
          onChange={(e) => setFgBrixStr(e.target.value)}
        />
      </CalcInputs>

      <CalcOutputs>
        <CalcOutput
          label="Corrected FG"
          value={fg != null ? formatGravity(fg, gravityUnit) : DASH}
          hint={ogSG != null ? `OG ${formatGravity(ogSG, gravityUnit)}` : 'enter OG + FG in °Brix'}
        />
        <CalcOutput
          label="ABV (≈)"
          value={abv != null ? `${abv.toFixed(1)}%` : DASH}
          hint="simple (OG − FG) × 131.25"
        />
      </CalcOutputs>
    </CalcCard>
  )
}
