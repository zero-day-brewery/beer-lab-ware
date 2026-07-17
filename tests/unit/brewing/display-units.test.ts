import { describe, expect, it } from 'vitest'
import {
  CANONICAL_EPSILON,
  formatAmount,
  formatForInput,
  formatWithUnit,
  fromDisplay,
  kindForMetricUnit,
  parseInput,
  type QuantityKind,
  toDisplay,
  unitLabel,
} from '@/lib/brewing/convert/display-units'

const KINDS: QuantityKind[] = [
  'volume',
  'volume-rate',
  'mass-grain',
  'mass-hop',
  'temp',
  'mash-ratio',
]

describe('unitLabel', () => {
  it('labels every kind in metric', () => {
    expect(unitLabel('volume', 'metric')).toBe('L')
    expect(unitLabel('volume-rate', 'metric')).toBe('L/hr')
    expect(unitLabel('mass-grain', 'metric')).toBe('kg')
    expect(unitLabel('mass-hop', 'metric')).toBe('g')
    expect(unitLabel('temp', 'metric')).toBe('°C')
    expect(unitLabel('mash-ratio', 'metric')).toBe('L/kg')
  })

  it('labels every kind in imperial', () => {
    expect(unitLabel('volume', 'imperial')).toBe('gal')
    expect(unitLabel('volume-rate', 'imperial')).toBe('gal/hr')
    expect(unitLabel('mass-grain', 'imperial')).toBe('lb')
    expect(unitLabel('mass-hop', 'imperial')).toBe('oz')
    expect(unitLabel('temp', 'imperial')).toBe('°F')
    expect(unitLabel('mash-ratio', 'imperial')).toBe('qt/lb')
  })
})

describe('toDisplay / fromDisplay — known anchors', () => {
  it('20 L = 5.283 gal', () => {
    expect(toDisplay(20, 'volume', 'imperial')).toBeCloseTo(5.283, 3)
    expect(fromDisplay(5.283, 'volume', 'imperial')).toBeCloseTo(20, 2)
  })

  it('1 kg = 2.20462 lb', () => {
    expect(toDisplay(1, 'mass-grain', 'imperial')).toBeCloseTo(2.20462, 5)
    expect(fromDisplay(2.20462, 'mass-grain', 'imperial')).toBeCloseTo(1, 5)
  })

  it('28.3495 g = 1 oz', () => {
    expect(toDisplay(28.3495, 'mass-hop', 'imperial')).toBeCloseTo(1, 4)
    expect(fromDisplay(1, 'mass-hop', 'imperial')).toBeCloseTo(28.3495, 3)
  })

  it('20 °C = 68 °F (affine, not linear)', () => {
    expect(toDisplay(20, 'temp', 'imperial')).toBeCloseTo(68, 6)
    expect(fromDisplay(68, 'temp', 'imperial')).toBeCloseTo(20, 6)
    expect(toDisplay(0, 'temp', 'imperial')).toBeCloseTo(32, 6)
    expect(toDisplay(100, 'temp', 'imperial')).toBeCloseTo(212, 6)
  })

  it('2.6 L/kg ≈ 1.246 qt/lb (classic mash thickness)', () => {
    expect(toDisplay(2.6, 'mash-ratio', 'imperial')).toBeCloseTo(1.246, 3)
    expect(fromDisplay(1.25, 'mash-ratio', 'imperial')).toBeCloseTo(2.608, 3)
  })

  it('volume-rate uses the same L↔gal factor', () => {
    expect(toDisplay(3, 'volume-rate', 'imperial')).toBeCloseTo(0.7925, 4)
  })
})

describe('metric mode is the identity', () => {
  it('toDisplay/fromDisplay pass values through unchanged for every kind', () => {
    for (const kind of KINDS) {
      expect(toDisplay(12.34, kind, 'metric')).toBe(12.34)
      expect(fromDisplay(12.34, kind, 'metric')).toBe(12.34)
    }
  })
})

describe('round-trip property: parse(format(x)) stays within epsilon', () => {
  const REPRESENTATIVE: Record<QuantityKind, number[]> = {
    volume: [0.5, 19, 20, 23.7, 40, 1000],
    'volume-rate': [1.5, 3, 4.25],
    'mass-grain': [0.05, 0.25, 4.54, 5.5, 25],
    'mass-hop': [7, 28, 28.3495, 56.7, 100],
    temp: [0, 4, 20, 65.5, 67, 78, 100],
    'mash-ratio': [2.4, 2.6, 3.13, 4],
  }

  for (const units of ['metric', 'imperial'] as const) {
    for (const kind of KINDS) {
      it(`${kind} round-trips in ${units}`, () => {
        for (const x of REPRESENTATIVE[kind]) {
          const text = formatForInput(x, kind, units)
          const back = parseInput(text, kind, units)
          expect(back).not.toBeNull()
          expect(Math.abs((back as number) - x)).toBeLessThanOrEqual(CANONICAL_EPSILON[kind])
        }
      })
    }
  }
})

describe('formatForInput', () => {
  it('trims trailing zeros', () => {
    expect(formatForInput(19, 'volume', 'metric')).toBe('19')
    expect(formatForInput(2.6, 'mash-ratio', 'metric')).toBe('2.6')
  })

  it('converts before formatting in imperial', () => {
    expect(formatForInput(19, 'volume', 'imperial')).toBe('5.019')
    expect(formatForInput(20, 'temp', 'imperial')).toBe('68')
  })
})

describe('parseInput', () => {
  it('returns null on empty / whitespace / non-numeric', () => {
    expect(parseInput('', 'volume', 'imperial')).toBeNull()
    expect(parseInput('   ', 'volume', 'metric')).toBeNull()
    expect(parseInput('abc', 'volume', 'imperial')).toBeNull()
  })

  it('parses imperial input back to canonical metric', () => {
    expect(parseInput('5', 'volume', 'imperial')).toBeCloseTo(18.927, 3)
    expect(parseInput('1', 'mass-grain', 'imperial')).toBeCloseTo(0.45359, 4)
    expect(parseInput('1', 'mass-hop', 'imperial')).toBeCloseTo(28.3495, 3)
    expect(parseInput('68', 'temp', 'imperial')).toBeCloseTo(20, 6)
  })
})

describe('formatAmount / formatWithUnit', () => {
  it('formats read-only metric amounts at kind defaults', () => {
    expect(formatAmount(19, 'volume', 'metric')).toBe('19.00')
    expect(formatAmount(4.5, 'mass-grain', 'metric')).toBe('4.500')
    expect(formatWithUnit(67, 'temp', 'metric')).toBe('67.0 °C')
  })

  it('formats read-only imperial amounts with converted value + label', () => {
    expect(formatAmount(20, 'volume', 'imperial')).toBe('5.28')
    expect(formatWithUnit(20, 'volume', 'imperial')).toBe('5.28 gal')
    expect(formatWithUnit(1, 'mass-grain', 'imperial')).toBe('2.20 lb')
    expect(formatWithUnit(28.3495, 'mass-hop', 'imperial')).toBe('1.00 oz')
    expect(formatWithUnit(67, 'temp', 'imperial')).toBe('152.6 °F')
  })

  it('honors an explicit decimal override', () => {
    expect(formatWithUnit(20, 'volume', 'imperial', 1)).toBe('5.3 gal')
    expect(formatWithUnit(20, 'volume', 'metric', 1)).toBe('20.0 L')
  })
})

describe('kindForMetricUnit — guided-flow token mapping', () => {
  it('maps the convertible metric token labels', () => {
    expect(kindForMetricUnit('L')).toBe('volume')
    expect(kindForMetricUnit('°C')).toBe('temp')
    expect(kindForMetricUnit('kg')).toBe('mass-grain')
    expect(kindForMetricUnit('L/kg')).toBe('mash-ratio')
  })

  it('leaves non-convertible labels alone (g stays g for salts/yeast; psi native)', () => {
    expect(kindForMetricUnit('g')).toBeNull()
    expect(kindForMetricUnit('psi')).toBeNull()
    expect(kindForMetricUnit('min')).toBeNull()
    expect(kindForMetricUnit(undefined)).toBeNull()
  })
})
