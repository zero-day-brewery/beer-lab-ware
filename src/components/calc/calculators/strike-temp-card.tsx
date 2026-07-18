'use client'
import { Thermometer } from 'lucide-react'
import { useDisplayNumberState } from '@/hooks/use-display-units'
import { formatForInput, formatWithUnit, unitLabel } from '@/lib/brewing/convert/display-units'
import { defaultMashRatio_LperKg } from '@/lib/brewing/mash/ratio'
import { calcStrikeTemp } from '@/lib/brewing/mash/strike'
import { CalcCard, CalcField, CalcInputs, CalcOutput, CalcOutputs, DASH } from './calc-card'

/**
 * Single-infusion strike-water temperature. Live-wraps `calcStrikeTemp` with the
 * project default mash ratio (2.6 L/kg ≈ 1.25 qt/lb) pre-filled. Inputs are
 * edited in the user's display units and converted to canonical °C + L/kg
 * before the engine runs; the output shows the primary unit with the other
 * system echoed in the hint.
 */
export function StrikeTempCard() {
  const target = useDisplayNumberState(67, 'temp')
  const grain = useDisplayNumberState(20, 'temp')
  const ratio = useDisplayNumberState(defaultMashRatio_LperKg, 'mash-ratio')
  const units = target.units

  const strike =
    target.canonical != null &&
    grain.canonical != null &&
    ratio.canonical != null &&
    ratio.canonical > 0
      ? calcStrikeTemp(target.canonical, grain.canonical, ratio.canonical)
      : null

  const other = units === 'imperial' ? 'metric' : 'imperial'

  return (
    <CalcCard
      icon={<Thermometer size={18} aria-hidden="true" />}
      title="Strike Water Temp"
      caption="Single-infusion mash-in"
    >
      <CalcInputs>
        <CalcField
          label={`Mash target ${unitLabel('temp', units)}`}
          type="number"
          step="0.5"
          value={target.text}
          placeholder={formatForInput(67, 'temp', units)}
          onChange={(e) => target.setText(e.target.value)}
        />
        <CalcField
          label={`Grain ${unitLabel('temp', units)}`}
          type="number"
          step="0.5"
          value={grain.text}
          placeholder={formatForInput(20, 'temp', units)}
          onChange={(e) => grain.setText(e.target.value)}
        />
        <CalcField
          label={`Ratio ${unitLabel('mash-ratio', units)}`}
          type="number"
          step={units === 'imperial' ? '0.05' : '0.1'}
          min="0"
          value={ratio.text}
          placeholder={formatForInput(defaultMashRatio_LperKg, 'mash-ratio', units)}
          onChange={(e) => ratio.setText(e.target.value)}
        />
      </CalcInputs>

      <CalcOutputs>
        <CalcOutput
          label="Strike temp"
          value={strike != null ? formatWithUnit(strike, 'temp', units, 1) : DASH}
          hint={
            strike != null ? formatWithUnit(strike, 'temp', other, 1) : 'enter target + grain temp'
          }
        />
      </CalcOutputs>
    </CalcCard>
  )
}
