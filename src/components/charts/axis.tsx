'use client'
import type { Tick } from '@/lib/brewing/charts/types'

export function Axis({
  orientation,
  ticks,
  length,
  label,
}: {
  orientation: 'left' | 'right' | 'bottom'
  ticks: Tick[]
  length: number
  label?: string
}) {
  const isBottom = orientation === 'bottom'
  const isLeft = orientation === 'left'
  return (
    <g className={`chart-axis chart-axis--${orientation}`} data-testid={`axis-${orientation}`}>
      {ticks.map((t) => (
        <g
          key={`${t.value}`}
          transform={isBottom ? `translate(${t.offset},0)` : `translate(0,${t.offset})`}
        >
          <line
            className="chart-axis-tick"
            x1={0}
            y1={0}
            x2={isBottom ? 0 : isLeft ? -4 : 4}
            y2={isBottom ? 4 : 0}
          />
          <text
            className="chart-axis-text"
            x={isBottom ? 0 : isLeft ? -8 : 8}
            y={isBottom ? 16 : 0}
            dy={isBottom ? undefined : '0.32em'}
            textAnchor={isBottom ? 'middle' : isLeft ? 'end' : 'start'}
          >
            {t.label}
          </text>
        </g>
      ))}
      {label && (
        <text
          className="chart-axis-label"
          data-testid={`axis-label-${orientation}`}
          x={isBottom ? length / 2 : 0}
          y={isBottom ? 26 : isLeft ? -8 : 8}
          textAnchor={isBottom ? 'middle' : 'start'}
        >
          {label}
        </text>
      )}
    </g>
  )
}
