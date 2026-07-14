'use client'

export interface LegendItem {
  id: string
  label: string
  color: string
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend" data-testid="chart-legend">
      {items.map((it) => (
        <li key={it.id} className="chart-legend-item">
          <span
            className="chart-legend-swatch"
            style={{ background: it.color }}
            aria-hidden="true"
          />
          {it.label}
        </li>
      ))}
    </ul>
  )
}
