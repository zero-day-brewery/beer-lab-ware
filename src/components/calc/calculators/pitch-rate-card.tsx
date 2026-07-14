'use client'
import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
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
  const [batchStr, setBatchStr] = useState('20')
  const [ogStr, setOgStr] = useState('1.050')
  const [style, setStyle] = useState<PitchStyle>('ale')

  const batchSize_L = Number(batchStr)
  const og = Number(ogStr)
  const valid = Number.isFinite(batchSize_L) && batchSize_L > 0 && Number.isFinite(og) && og > 1

  const result = valid ? calcPitchRate({ batchSize_L, og, style }) : null

  return (
    <CalcCard
      icon={<FlaskConical size={18} aria-hidden="true" />}
      title="Yeast Pitch Rate"
      caption="White & Zainasheff cell count"
    >
      <CalcInputs>
        <CalcField
          label="Batch (L)"
          type="number"
          step="0.5"
          min="0"
          value={batchStr}
          placeholder="20"
          onChange={(e) => setBatchStr(e.target.value)}
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
