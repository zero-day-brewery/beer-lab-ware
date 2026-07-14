'use client'
import { ArrowLeftRight } from 'lucide-react'
import { useState } from 'react'
import { platoToSG, sgToBrix, sgToPlato } from '@/lib/brewing/convert/gravity'
import {
  CalcCard,
  CalcField,
  CalcInputs,
  CalcOutput,
  CalcOutputs,
  CalcSelect,
  DASH,
} from './calc-card'

type Unit = 'sg' | 'brix' | 'plato'

/** Normalise any input unit to canonical SG, then re-derive all three. */
function toSG(value: number, unit: Unit): number {
  if (unit === 'sg') return value
  // Brix and Plato share the same scale in this engine (sgToBrix === sgToPlato).
  return platoToSG(value)
}

/**
 * Gravity ⇄ Brix ⇄ Plato converter. Enter one value in a chosen unit; the card
 * normalises to SG and shows all three. Pure `convert/gravity` helpers, live.
 */
export function GravityConvertCard() {
  const [unit, setUnit] = useState<Unit>('sg')
  const [valStr, setValStr] = useState('1.050')

  const value = Number(valStr)
  const valid = Number.isFinite(value) && value > 0 && (unit !== 'sg' || value > 0.5)
  const sg = valid ? toSG(value, unit) : null

  return (
    <CalcCard
      icon={<ArrowLeftRight size={18} aria-hidden="true" />}
      title="Gravity ⇄ Brix ⇄ Plato"
      caption="Enter one, read all three"
    >
      <CalcInputs>
        <CalcSelect
          label="Input unit"
          value={unit}
          onChange={(e) => {
            const next = e.target.value as Unit
            setUnit(next)
            // Reseed with a sensible default so switching units never leaves a
            // nonsensical value (e.g. 1.050 °Brix).
            setValStr(next === 'sg' ? '1.050' : '12')
          }}
        >
          <option value="sg">SG</option>
          <option value="brix">°Brix</option>
          <option value="plato">°Plato</option>
        </CalcSelect>
        <CalcField
          label="Value"
          type="number"
          step={unit === 'sg' ? '0.001' : '0.1'}
          min="0"
          value={valStr}
          onChange={(e) => setValStr(e.target.value)}
        />
      </CalcInputs>

      <CalcOutputs>
        <CalcOutput label="SG" value={sg != null ? sg.toFixed(3) : DASH} />
        <CalcOutput label="°Plato" value={sg != null ? `${sgToPlato(sg).toFixed(1)} °P` : DASH} />
        <CalcOutput label="°Brix" value={sg != null ? `${sgToBrix(sg).toFixed(1)} °Bx` : DASH} />
      </CalcOutputs>
    </CalcCard>
  )
}
