import { describe, expect, it } from 'vitest'
import { buildChartModel } from '@/lib/brewing/charts/build-chart-model'
import type { AxisConfig, SeriesConfig } from '@/lib/brewing/charts/types'

const T0 = Date.parse('2026-07-04T00:00:00.000Z')
const DAY = 86_400_000

const gravity: SeriesConfig = {
  id: 'gravity',
  label: 'Gravity',
  data: [
    { t: T0, v: 1.05 },
    { t: T0 + DAY, v: 1.03 },
    { t: T0 + 2 * DAY, v: 1.012 },
  ],
  axis: 'left',
  color: 'var(--wort, var(--malt))',
  area: true,
  format: (v) => v.toFixed(3),
}
const temp: SeriesConfig = {
  id: 'temp',
  label: 'Temp °C',
  data: [
    { t: T0, v: 20 },
    { t: T0 + DAY, v: 21 },
    { t: T0 + 2 * DAY, v: 19 },
  ],
  axis: 'right',
  color: 'var(--primary)',
  format: (v) => `${Math.round(v)}°C`,
}
const left: AxisConfig = { label: 'Gravity', ticks: 5, nice: true, format: (v) => v.toFixed(3) }
const right: AxisConfig = {
  label: 'Temp °C',
  ticks: 5,
  nice: true,
  format: (v) => `${Math.round(v)}°C`,
}

describe('buildChartModel', () => {
  it('computes the inner rect from default margins', () => {
    const m = buildChartModel({ width: 400, height: 200, series: [gravity, temp], left, right })
    expect(m.inner).toEqual({ x: 52, y: 12, width: 296, height: 160 })
  })

  it('maps the time domain across the inner width (endpoints exact, TZ-independent)', () => {
    const m = buildChartModel({ width: 400, height: 200, series: [gravity, temp], left, right })
    expect(m.xToPx(T0)).toBeCloseTo(0, 6)
    expect(m.xToPx(T0 + 2 * DAY)).toBeCloseTo(296, 6)
    expect(m.xToPx(T0 + DAY)).toBeCloseTo(148, 6)
    expect(m.pxToT(0)).toBeCloseTo(T0, 3)
    expect(m.pxToT(296)).toBeCloseTo(T0 + 2 * DAY, 3)
  })

  it('produces left + right ticks with in-range offsets', () => {
    const m = buildChartModel({ width: 400, height: 200, series: [gravity, temp], left, right })
    expect(m.leftTicks.length).toBeGreaterThan(0)
    expect(m.rightTicks.length).toBeGreaterThan(0)
    for (const t of m.leftTicks) expect(t.offset).toBeGreaterThanOrEqual(-0.01)
    for (const t of m.leftTicks) expect(t.offset).toBeLessThanOrEqual(160.01)
    expect(m.leftTicks[0].label).toMatch(/^\d\.\d{3}$/)
  })

  it('produces x ticks whose offsets sit within the inner width', () => {
    const m = buildChartModel({ width: 400, height: 200, series: [gravity, temp], left, right })
    expect(m.xTicks.length).toBeGreaterThanOrEqual(2)
    for (const t of m.xTicks) {
      expect(t.offset).toBeGreaterThanOrEqual(-0.01)
      expect(t.offset).toBeLessThanOrEqual(296.01)
      expect(t.value).toBeGreaterThanOrEqual(T0)
      expect(t.value).toBeLessThanOrEqual(T0 + 2 * DAY)
    }
  })

  it('builds line + area paths with exact point coords and no NaN', () => {
    const m = buildChartModel({ width: 400, height: 200, series: [gravity, temp], left, right })
    const g = m.series.find((s) => s.id === 'gravity')
    expect(g).toBeDefined()
    if (!g) return
    expect(g.linePath.startsWith('M')).toBe(true)
    expect(g.linePath.includes('NaN')).toBe(false)
    expect(g.linePath.includes('C')).toBe(true)
    expect(g.areaPath?.startsWith('M')).toBe(true)
    expect(g.points.map((p) => Math.round(p.cx))).toEqual([0, 148, 296])
    for (const p of g.points) expect(p.cy).toBeGreaterThanOrEqual(-0.01)
    for (const p of g.points) expect(p.cy).toBeLessThanOrEqual(160.01)
  })

  it('flat series (min===max) yields a finite path with no divide-by-zero', () => {
    const flat: SeriesConfig = { ...gravity, data: gravity.data.map((p) => ({ ...p, v: 1.04 })) }
    const m = buildChartModel({ width: 400, height: 200, series: [flat], left })
    const g = m.series[0]
    expect(g.linePath.includes('NaN')).toBe(false)
    expect(g.points.every((p) => Number.isFinite(p.cy))).toBe(true)
  })

  it('single-point series draws without dividing by zero', () => {
    const one: SeriesConfig = { ...gravity, data: [{ t: T0, v: 1.05 }] }
    const m = buildChartModel({ width: 400, height: 200, series: [one], left })
    expect(m.series[0].points).toHaveLength(1)
    expect(m.series[0].linePath.startsWith('M')).toBe(true)
    expect(m.series[0].linePath.includes('NaN')).toBe(false)
  })

  it('empty series yields empty paths and points without throwing', () => {
    const empty: SeriesConfig = { ...gravity, data: [] }
    const m = buildChartModel({ width: 400, height: 200, series: [empty], left })
    expect(m.series[0].points).toHaveLength(0)
    expect(m.series[0].linePath).toBe('')
  })
})
