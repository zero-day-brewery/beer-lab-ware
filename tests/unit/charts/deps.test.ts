import { extent } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import { curveMonotoneX, line } from 'd3-shape'
import { describe, expect, it } from 'vitest'

describe('d3 math deps', () => {
  it('scaleLinear maps a domain to a range', () => {
    const s = scaleLinear().domain([0, 1]).range([0, 100])
    expect(s(0.5)).toBe(50)
  })

  it('d3-array extent finds min/max', () => {
    expect(extent([3, 1, 2])).toEqual([1, 3])
  })

  it('d3-shape line + curveMonotoneX produces a path string', () => {
    const gen = line<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1])
      .curve(curveMonotoneX)
    const path = gen([
      [0, 0],
      [1, 1],
    ])
    expect(path?.startsWith('M')).toBe(true)
  })
})
