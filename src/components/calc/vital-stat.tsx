interface VitalStatProps {
  label: string
  value: string
  target?: [number, number]
  current?: number
}

type Tone = 'neutral' | 'in' | 'warn' | 'out'

function statusFor(current: number, min: number, max: number): { tone: Tone; text: string } {
  const margin = (max - min) * 0.05
  if (current >= min && current <= max) return { tone: 'in', text: 'In style' }
  if (current >= min - margin && current <= max + margin)
    return { tone: 'warn', text: 'Borderline' }
  return current < min ? { tone: 'out', text: 'Below style' } : { tone: 'out', text: 'Above style' }
}

/**
 * One vital (OG/FG/ABV/IBU/SRM) shown as a range gauge with the
 * BJCP band, a marker at the current value, the value in mono, and a TEXT status
 * (not color alone — WCAG 1.4.1). Status colors come from theme-consistent tokens.
 */
export function VitalStat({ label, value, target, current }: VitalStatProps) {
  const hasGauge = target && typeof current === 'number'

  let toneClass = 'is-neutral'
  let statusText = ''
  let bandLeft = 0
  let bandWidth = 0
  let markerPct = 0
  let arrow = ''

  if (hasGauge) {
    const [min, max] = target
    const range = Math.max(max - min, Math.abs(max) * 0.02, 0.0001)
    const pad = range * 0.6
    const domainMin = min - pad
    const domainMax = max + pad
    const span = domainMax - domainMin
    bandLeft = ((min - domainMin) / span) * 100
    bandWidth = ((max - min) / span) * 100
    markerPct = Math.min(100, Math.max(0, ((current - domainMin) / span) * 100))
    const status = statusFor(current, min, max)
    toneClass = `is-${status.tone}`
    statusText = status.text
    arrow = status.tone === 'in' ? '✓' : current < min ? '↓' : '↑'
  }

  return (
    <div className={`gaugecard ${toneClass}`}>
      <div className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className="gauge-value">{value}</span>
      </div>
      {hasGauge ? (
        <>
          <div className="gauge-track" aria-hidden="true">
            <span className="gauge-band" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
            <span className="gauge-marker" style={{ left: `${markerPct}%` }} />
          </div>
          <div className="gauge-foot">
            <span className="gauge-range">
              {target?.[0]}–{target?.[1]}
            </span>
            <span className="gauge-status">
              <span aria-hidden="true">{arrow}</span> {statusText}
            </span>
          </div>
        </>
      ) : (
        <div className="gauge-foot">
          <span className="gauge-range">no style selected</span>
        </div>
      )}
    </div>
  )
}
