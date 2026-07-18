'use client'
import { Gauge } from 'lucide-react'
import { useState } from 'react'
import { useDisplayNumberState } from '@/hooks/use-display-units'
import { calcForceCarb } from '@/lib/brewing/carbonation/force-carb'
import { balancedLineLength_ft } from '@/lib/brewing/carbonation/line-balance'
import { calcSpunding } from '@/lib/brewing/carbonation/spunding'
import { formatForInput, unitLabel } from '@/lib/brewing/convert/display-units'
import { CalcCard, CalcField, CalcInputs, CalcOutput, DASH } from './calc-card'

/**
 * Carbonation card with three live sub-sections, each wrapping a real engine:
 *   - Force carb   → `calcForceCarb`   (cold set-and-forget SET psi)
 *   - Spunding     → `calcSpunding`    (warm ferment setpoint, MAWP-capped)
 *   - Line balance → `balancedLineLength_ft`
 * All strings-in, parse + guard, no submit. Temperatures are edited in the
 * user's display units (°F when imperial) and converted to canonical °C for
 * the engines; CO₂ volumes + psi are unit-system-independent already.
 */
export function CarbonationCard() {
  // Force carb — temp edited in display units, `.canonical` is °C.
  const [fcVolStr, setFcVolStr] = useState('2.4')
  const fcTempState = useDisplayNumberState(4, 'temp')
  const units = fcTempState.units
  // Spunding
  const [spVolStr, setSpVolStr] = useState('2.4')
  const spTempState = useDisplayNumberState(12, 'temp')
  const [spMawpStr, setSpMawpStr] = useState('30')
  // Line balance
  const [linePsiStr, setLinePsiStr] = useState('11')
  const [lineResStr, setLineResStr] = useState('2')

  const fcVol = Number(fcVolStr)
  const fcTemp = fcTempState.canonical
  const fcValid = Number.isFinite(fcVol) && fcVol > 0 && fcTemp != null
  const forceCarb = fcValid
    ? calcForceCarb({ targetVol: fcVol, servingTemp_C: fcTemp as number })
    : null

  const spVol = Number(spVolStr)
  const spTemp = spTempState.canonical
  const spMawp = Number(spMawpStr)
  const spValid =
    Number.isFinite(spVol) && spVol > 0 && spTemp != null && Number.isFinite(spMawp) && spMawp > 0
  const spunding = spValid
    ? calcSpunding({ targetVol: spVol, fermTemp_C: spTemp as number, mawp_psi: spMawp })
    : null

  const linePsi = Number(linePsiStr)
  const lineRes = Number(lineResStr)
  const lineValid =
    Number.isFinite(linePsi) && linePsi > 0 && Number.isFinite(lineRes) && lineRes > 0
  const lineLen = lineValid
    ? balancedLineLength_ft({ servingPsi: linePsi, resistance_psiPerFt: lineRes })
    : null

  return (
    <CalcCard
      icon={<Gauge size={18} aria-hidden="true" />}
      title="Carbonation"
      caption="Force · spunding · line balance"
    >
      <div className="flex flex-col gap-2">
        <div className="calc-block-title !mb-0">Force carb (cold set psi)</div>
        <CalcInputs>
          <CalcField
            label="Target vol"
            type="number"
            step="0.1"
            min="0"
            value={fcVolStr}
            placeholder="2.4"
            onChange={(e) => setFcVolStr(e.target.value)}
          />
          <CalcField
            label={`Serving ${unitLabel('temp', units)}`}
            type="number"
            step="0.5"
            value={fcTempState.text}
            placeholder={formatForInput(4, 'temp', units)}
            onChange={(e) => fcTempState.setText(e.target.value)}
          />
        </CalcInputs>
        <CalcOutput
          label="Set pressure"
          value={forceCarb ? `${forceCarb.setPsi.toFixed(1)} psi` : DASH}
          hint={forceCarb ? 'regulator, set-and-forget' : 'enter vol + temp'}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="calc-block-title !mb-0">Spunding (warm ferment)</div>
        <CalcInputs>
          <CalcField
            label="Target vol"
            type="number"
            step="0.1"
            min="0"
            value={spVolStr}
            placeholder="2.4"
            onChange={(e) => setSpVolStr(e.target.value)}
          />
          <CalcField
            label={`Ferment ${unitLabel('temp', units)}`}
            type="number"
            step="0.5"
            value={spTempState.text}
            placeholder={formatForInput(12, 'temp', units)}
            onChange={(e) => spTempState.setText(e.target.value)}
          />
          <CalcField
            label="MAWP psi"
            type="number"
            step="1"
            min="0"
            value={spMawpStr}
            placeholder="30"
            onChange={(e) => setSpMawpStr(e.target.value)}
          />
        </CalcInputs>
        <CalcOutput
          label="Spunding setpoint"
          value={spunding ? `${spunding.setpoint_psi.toFixed(1)} psi` : DASH}
          hint={
            spunding
              ? spunding.cappedToMawp
                ? 'capped to MAWP · finish cold in keg'
                : 'valve setpoint'
              : 'enter vol + temp + MAWP'
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="calc-block-title !mb-0">Balanced line length</div>
        <CalcInputs>
          <CalcField
            label="Serving psi"
            type="number"
            step="0.5"
            min="0"
            value={linePsiStr}
            placeholder="11"
            onChange={(e) => setLinePsiStr(e.target.value)}
          />
          <CalcField
            label="psi / ft"
            type="number"
            step="0.1"
            min="0"
            value={lineResStr}
            placeholder="2"
            onChange={(e) => setLineResStr(e.target.value)}
          />
        </CalcInputs>
        <CalcOutput
          label="Line length"
          value={lineLen != null ? `${lineLen.toFixed(1)} ft` : DASH}
          hint={lineLen != null ? 'lengthen if pours foam' : 'enter psi + resistance'}
        />
      </div>

      <p className="text-[0.68rem] text-muted-foreground" role="note">
        Safety: pressure outputs are estimates. Always verify against your keg or fermenter&apos;s
        rated MAWP and the manufacturer&apos;s specs before applying pressure — over-pressurized
        vessels and bottles can cause injury.
      </p>
    </CalcCard>
  )
}
