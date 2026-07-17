'use client'
import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { useDisplayNumberState } from '@/hooks/use-display-units'
import { formatForInput, unitLabel } from '@/lib/brewing/convert/display-units'
import { calcPitchRate, type PitchStyle } from '@/lib/brewing/pitch/pitch-rate'
import {
  CalcCard,
  CalcField,
  CalcInputs,
  CalcOutput,
  CalcOutputs,
  CalcSelect,
  DASH,
} from './calc-card'

const STYLE_LABELS: Record<PitchStyle, string> = {
  ale: 'Ale (0.75)',
  lager: 'Lager (1.5)',
  pressure: 'Pressure (1.5)',
  'high-gravity': 'High gravity (1.0)',
}

/**
 * Yeast pitch-rate card. Live-wraps `calcPitchRate` — inputs held as strings,
 * parsed + guarded every render, no submit. Reports billion cells needed plus
 * the dry-yeast gram estimate (cells_B ÷ 20 B/g).
 */
export function PitchRateCard() {
  // Edited in display units (gal when imperial); `.canonical` is liters.
  const batch = useDisplayNumberState(20, 'volume')
  const units = batch.units
  const [ogStr, setOgStr] = useState('1.050')
  const [style, setStyle] = useState<PitchStyle>('ale')

  const batchSize_L = batch.canonical
  const og = Number(ogStr)
  const valid = batchSize_L != null && batchSize_L > 0 && Number.isFinite(og) && og > 1

  const result = valid ? calcPitchRate({ batchSize_L: batchSize_L as number, og, style }) : null

  return (
    <CalcCard
      icon={<FlaskConical size={18} aria-hidden="true" />}
      title="Yeast Pitch Rate"
      caption="White & Zainasheff cell count"
    >
      <CalcInputs>
        <CalcField
          label={`Batch (${unitLabel('volume', units)})`}
          type="number"
          step={units === 'imperial' ? '0.25' : '0.5'}
          min="0"
          value={batch.text}
          placeholder={formatForInput(20, 'volume', units)}
          onChange={(e) => batch.setText(e.target.value)}
        />
        <CalcField
          label="OG"
          type="number"
          step="0.001"
          value={ogStr}
          placeholder="1.050"
          onChange={(e) => setOgStr(e.target.value)}
        />
        <CalcSelect
          label="Style"
          value={style}
          onChange={(e) => setStyle(e.target.value as PitchStyle)}
        >
          {(Object.keys(STYLE_LABELS) as PitchStyle[]).map((k) => (
            <option key={k} value={k}>
              {STYLE_LABELS[k]}
            </option>
          ))}
        </CalcSelect>
      </CalcInputs>

      <CalcOutputs>
        <CalcOutput
          label="Cells needed"
          value={result ? `${result.cells_B.toFixed(0)} B` : DASH}
          hint={
            result
              ? `${result.plato.toFixed(1)} °P · ${result.rate_M_per_mL_per_P} M/mL/°P`
              : 'enter batch + OG'
          }
        />
        <CalcOutput
          label="Dry yeast (≈)"
          value={result ? `${(result.cells_B / 20).toFixed(1)} g` : DASH}
          hint="cells ÷ 20 B viable / g"
        />
      </CalcOutputs>
    </CalcCard>
  )
}
