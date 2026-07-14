import { describe, expect, it } from 'vitest'
import type {
  AxisConfig,
  ChartModelInput,
  SeriesConfig,
  SeriesPoint,
} from '@/lib/brewing/charts/types'

describe('chart types', () => {
  it('SeriesPoint/SeriesConfig/AxisConfig/ChartModelInput compile with expected fields', () => {
    const p: SeriesPoint = { t: 0, v: 1.05 }
    const s: SeriesConfig = {
      id: 'gravity',
      label: 'Gravity',
      data: [p],
      axis: 'left',
      color: 'var(--wort, var(--malt))',
      area: true,
      format: (v) => v.toFixed(3),
    }
    const left: AxisConfig = { label: 'Gravity', ticks: 5, nice: true, format: (v) => v.toFixed(3) }
    const input: ChartModelInput = { width: 400, height: 200, series: [s], left }
    expect(input.series[0].data[0].t).toBe(0)
    expect(input.series[0].format(1.05)).toBe('1.050')
    expect(left.label).toBe('Gravity')
  })
})
