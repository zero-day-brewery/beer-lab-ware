import { describe, expect, it } from 'vitest'
import { nearestByTime, valueAtOrNearest } from '@/lib/brewing/charts/nearest'
import type { SeriesPoint } from '@/lib/brewing/charts/types'

const pts: SeriesPoint[] = [
  { t: 0, v: 1 },
  { t: 10, v: 2 },
  { t: 20, v: 3 },
]

describe('nearestByTime', () => {
  it('returns null for an empty series', () => {
    expect(nearestByTime([], 5)).toBeNull()
  })
  it('snaps to the nearest index by time', () => {
    expect(nearestByTime(pts, 3)).toBe(0)
    expect(nearestByTime(pts, 6)).toBe(1)
    expect(nearestByTime(pts, 14)).toBe(1)
    expect(nearestByTime(pts, 16)).toBe(2)
  })
  it('clamps beyond the ends', () => {
    expect(nearestByTime(pts, -100)).toBe(0)
    expect(nearestByTime(pts, 999)).toBe(2)
  })
  it('ignores gaps — snaps to actual points regardless of missing samples', () => {
    const gapped: SeriesPoint[] = [
      { t: 0, v: 1 },
      { t: 100, v: 2 },
    ]
    expect(nearestByTime(gapped, 40)).toBe(0)
    expect(nearestByTime(gapped, 60)).toBe(1)
  })
})

describe('valueAtOrNearest', () => {
  it('returns the nearest point or null', () => {
    expect(valueAtOrNearest(pts, 6)?.v).toBe(2)
    expect(valueAtOrNearest([], 6)).toBeNull()
  })
})
