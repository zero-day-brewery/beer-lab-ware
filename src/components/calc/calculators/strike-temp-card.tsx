'use client'
import { Thermometer } from 'lucide-react'
import { useState } from 'react'
import { cToF } from '@/lib/brewing/convert/temp'
import { defaultMashRatio_LperKg } from '@/lib/brewing/mash/ratio'
import { calcStrikeTemp } from '@/lib/brewing/mash/strike'
import { CalcCard, CalcField, CalcInputs, CalcOutput, CalcOutputs, DASH } from './calc-card'

/**
 * Single-infusion strike-water temperature. Live-wraps `calcStrikeTemp` with the
 * project default mash ratio (2.6 L/kg) pre-filled. Shows °C plus a °F echo.
 */
export function StrikeTempCard() {
  const [targetStr, setTargetStr] = useState('67')
  const [grainStr, setGrainStr] = useState('20')
  const [ratioStr, setRatioStr] = useState(String(defaultMashRatio_LperKg))

  const target = Number(targetStr)
  const grain = Number(grainStr)
  const ratio = Number(ratioStr)
  const valid =
    Number.isFinite(target) && Number.isFinite(grain) && Number.isFinite(ratio) && ratio > 0
  const strike = valid ? calcStrikeTemp(target, grain, ratio) : null

  return (
    <CalcCard
      icon={<Thermometer size={18} aria-hidden="true" />}
      title="Strike Water Temp"
      caption="Single-infusion mash-in"
    >
      <CalcInputs>
        <CalcField
          label="Mash target °C"
          type="number"
          step="0.5"
          value={targetStr}
          placeholder="67"
          onChange={(e) => setTargetStr(e.target.value)}
        />
        <CalcField
          label="Grain °C"
          type="number"
          step="0.5"
          value={grainStr}
          placeholder="20"
          onChange={(e) => setGrainStr(e.target.value)}
        />
        <CalcField
          label="Ratio L/kg"
          type="number"
          step="0.1"
          min="0"
          value={ratioStr}
          placeholder="2.6"
          onChange={(e) => setRatioStr(e.target.value)}
        />
      </CalcInputs>

      <CalcOutputs>
        <CalcOutput
          label="Strike temp"
          value={strike != null ? `${strike.toFixed(1)} °C` : DASH}
          hint={strike != null ? `${cToF(strike).toFixed(1)} °F` : 'enter target + grain temp'}
        />
      </CalcOutputs>
    </CalcCard>
  )
}
