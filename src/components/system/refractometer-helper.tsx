'use client'
import { useState } from 'react'
import { brixToSG, roundSG } from '@/lib/brewing/convert/gravity'
import { correctedFG } from '@/lib/brewing/convert/refractometer'

/**
 * Inline refractometer FG correction (Sean Terrill). Inputs raw Brix; the cubic
 * needs no separate wort-correction factor. Applies the corrected gravity back to
 * the fermenter via `onApply`.
 */
export function RefractometerHelper({
  og,
  onApply,
}: {
  og?: number
  onApply: (sg: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [ogStr, setOgStr] = useState(og != null ? String(og) : '')
  const [brixStr, setBrixStr] = useState('')

  const ogNum = Number(ogStr)
  const brixNum = Number(brixStr)
  const valid = Number.isFinite(ogNum) && ogNum > 1 && Number.isFinite(brixNum) && brixNum > 0
  const fg = valid ? correctedFG(ogNum, brixToSG(brixNum)) : null
  const abvValue = fg != null && ogNum > fg ? (ogNum - fg) * 131.25 : null

  if (!open) {
    return (
      <button type="button" className="refrac-toggle" onClick={() => setOpen(true)}>
        📐 Refractometer
      </button>
    )
  }

  return (
    <div className="refrac">
      <div className="refrac-inputs">
        <label>
          <span>OG</span>
          <input
            type="number"
            step="0.001"
            value={ogStr}
            placeholder="1.060"
            onChange={(e) => setOgStr(e.target.value)}
          />
        </label>
        <label>
          <span>Now °Bx</span>
          <input
            type="number"
            step="0.1"
            value={brixStr}
            placeholder="6.5"
            onChange={(e) => setBrixStr(e.target.value)}
          />
        </label>
      </div>
      <div className="refrac-out">
        {fg != null ? (
          <>
            <span>
              FG <b>{fg.toFixed(3)}</b>
              {abvValue != null && <> · {abvValue.toFixed(1)}% ABV</>}
            </span>
            <button
              type="button"
              className="refrac-apply"
              onClick={() => {
                onApply(roundSG(fg))
                setOpen(false)
              }}
            >
              Use
            </button>
          </>
        ) : (
          <span className="refrac-hint">enter OG + current Brix</span>
        )}
        <button
          type="button"
          className="refrac-close"
          onClick={() => setOpen(false)}
          aria-label="Close refractometer"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
