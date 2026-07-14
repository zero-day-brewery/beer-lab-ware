'use client'

export function Crosshair({
  x,
  height,
  marks,
}: {
  x: number
  height: number
  marks: { id: string; cx: number; cy: number; color: string }[]
}) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative SVG group, not focusable (pointer-events:none)
    <g
      className="chart-crosshair"
      data-testid="chart-crosshair"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <line className="chart-crosshair-line" x1={x} x2={x} y1={0} y2={height} />
      {marks.map((m) => (
        <circle
          key={m.id}
          className="chart-crosshair-dot"
          cx={m.cx}
          cy={m.cy}
          r={4}
          style={{ color: m.color }}
          fill="currentColor"
        />
      ))}
    </g>
  )
}
