'use client'
import { Percent } from 'lucide-react'
import { useState } from 'react'
import { calcABV } from '@/lib/brewing/calc/abv'
import type { ABVFormula } from '@/lib/brewing/types/equipment'
import {
  CalcCard,
  CalcField,
  CalcInputs,
  CalcOutput,
  CalcOutputs,
  CalcSelect,
  DASH,
} from './calc-card'

/**
 * ABV from OG/FG. Live-wraps `calcABV` (which returns 0 when FG >= OG). Inputs
 * are strings, parsed + guarded each render.
 */
export function AbvCard() {
  const [ogStr, setOgStr] = useState('1.050')
  const [fgStr, setFgStr] = useState('1.010')
  const [formula, setFormula] = useState<ABVFormula>('simple')

  const og = Number(ogStr)
  const fg = Number(fgStr)
  const valid = Number.isFinite(og) && og > 1 && Number.isFinite(fg) && fg > 0
  const abv = valid ? calcABV(og, fg, formula) : null

  return (
    <CalcCard icon={<Percent size={18} aria-hidden="true" />} title="ABV" caption="From OG & FG">
      <CalcInputs>
        <CalcField
          label="OG"
          type="number"
          step="0.001"
          value={ogStr}
          placeholder="1.050"
          onChange={(e) => setOgStr(e.target.value)}
        />
        <CalcField
          label="FG"
          type="number"
          step="0.001"
          value={fgStr}
          placeholder="1.010"
          onChange={(e) => setFgStr(e.target.value)}
        />
        <CalcSelect
          label="Formula"
          value={formula}
          onChange={(e) => setFormula(e.target.value as ABVFormula)}
        >
          <option value="simple">Simple</option>
          <option value="advanced">Advanced</option>
        </CalcSelect>
      </CalcInputs>

      <CalcOutputs>
        <CalcOutput
          label="ABV"
          value={abv != null ? `${abv.toFixed(2)}%` : DASH}
          hint={
            abv != null
              ? formula === 'simple'
                ? '(OG − FG) × 131.25'
                : 'high-gravity correction'
              : 'enter OG + FG'
          }
        />
      </CalcOutputs>
    </CalcCard>
  )
}
