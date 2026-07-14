'use client'

export interface TooltipRow {
  id: string
  label: string
  value: string
  color: string
}

export function Tooltip({
  x,
  y,
  width,
  title,
  rows,
}: {
  x: number
  y: number
  width: number
  title: string
  rows: TooltipRow[]
}) {
  const flip = x > width * 0.6
  return (
    <div
      className="chart-tooltip"
      data-testid="chart-tooltip"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: flip
          ? 'translate(-100%, -50%) translateX(-10px)'
          : 'translateY(-50%) translateX(10px)',
        pointerEvents: 'none',
      }}
    >
      <div className="chart-tooltip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.id} className="chart-tooltip-row">
          <span
            className="chart-tooltip-swatch"
            style={{ background: r.color }}
            aria-hidden="true"
          />
          <span className="chart-tooltip-label">{r.label}</span>
          <span className="chart-tooltip-value">{r.value}</span>
        </div>
      ))}
    </div>
  )
}
