import { describe, expect, it } from 'vitest'
import { parseBeerXML } from '@/lib/brewing/beerxml/parse'
import { serializeBeerXML } from '@/lib/brewing/beerxml/serialize'
import type { Recipe } from '@/lib/brewing/types/recipe'

/**
 * Round-trip fidelity regression tests (import -> export -> import).
 * Each case mirrors a confirmed audit bug where data was silently dropped
 * or mangled on a single hop through BeerXML.
 */

function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: '550e8400-e29b-41d4-a716-446655440099',
    name: 'Round Trip',
    type: 'all-grain',
    batchSize_L: 19,
    boilTime_min: 60,
    equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
    styleId: undefined,
    fermentables: [
      {
        ingredientId: '550e8400-e29b-41d4-a716-446655440101',
        snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
        amount_kg: 4.5,
        usage: 'mash',
        afterBoil: false,
      },
    ],
    hops: [
      {
        ingredientId: '550e8400-e29b-41d4-a716-446655440201',
        snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
        amount_g: 28,
        time_min: 60,
        use: 'boil',
      },
    ],
    yeasts: [
      {
        ingredientId: '550e8400-e29b-41d4-a716-446655440301',
        snapshot: { name: 'US-05', attenuation_min_pct: 75, attenuation_max_pct: 82, form: 'dry' },
        amount: 11.5,
      },
    ],
    miscs: [],
    mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
    notes_md: 'Test',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  }
}

function roundTrip(r: Recipe): Recipe {
  const xml = serializeBeerXML([r])
  const reparsed = parseBeerXML(xml)
  expect(reparsed).toHaveLength(1)
  return reparsed[0]
}

describe('round-trip (bug 5: misc amountUnit preserved)', () => {
  it('preserves tsp / ml / tbsp / each units', () => {
    const units = ['tsp', 'ml', 'tbsp', 'each', 'g'] as const
    const r = baseRecipe({
      miscs: units.map((u, i) => ({
        ingredientId: `550e8400-e29b-41d4-a716-44665544040${i}`,
        snapshot: { name: `Misc ${u}`, type: 'other' as const },
        amount: 2,
        amountUnit: u,
        use: 'boil' as const,
        time_min: 10,
      })),
    })
    const out = roundTrip(r)
    expect(out.miscs.map((m) => m.amountUnit)).toEqual([...units])
  })
})

describe('round-trip (bug 6: yeast attenuation range preserved)', () => {
  it('keeps attenuation_min_pct / attenuation_max_pct exactly', () => {
    const out = roundTrip(baseRecipe())
    expect(out.yeasts[0].snapshot.attenuation_min_pct).toBe(75)
    expect(out.yeasts[0].snapshot.attenuation_max_pct).toBe(82)
  })
})

describe('round-trip (bug 7: misc use preserved)', () => {
  it('preserves primary / secondary / bottling / mash / boil', () => {
    const uses = ['primary', 'secondary', 'bottling', 'mash', 'boil'] as const
    const r = baseRecipe({
      miscs: uses.map((u, i) => ({
        ingredientId: `550e8400-e29b-41d4-a716-44665544050${i}`,
        snapshot: { name: `Misc ${u}`, type: 'other' as const },
        amount: 1,
        amountUnit: 'g' as const,
        use: u,
        time_min: 0,
      })),
    })
    const out = roundTrip(r)
    expect(out.miscs.map((m) => m.use)).toEqual([...uses])
  })
})

describe('round-trip (bug 8: recipe-level fields preserved)', () => {
  it('preserves styleId, targets, yeast pitch temp, mash water/ramp', () => {
    const r = baseRecipe({
      styleId: 'american-ipa',
      targets: { OG: 1.052, FG: 1.01, ABV: 5.5, IBU: 40, SRM: 6 },
      yeasts: [
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440301',
          snapshot: {
            name: 'US-05',
            attenuation_min_pct: 75,
            attenuation_max_pct: 82,
            form: 'dry',
          },
          amount: 11.5,
          pitchTemp_C: 18,
        },
      ],
      mashSteps: [
        {
          name: 'Sacc',
          type: 'infusion',
          temperature_C: 66,
          time_min: 60,
          waterAmount_L: 15,
          rampTime_min: 2,
        },
      ],
    })
    const out = roundTrip(r)
    expect(out.styleId).toBe('american-ipa')
    expect(out.targets?.OG).toBeCloseTo(1.052, 3)
    expect(out.targets?.FG).toBeCloseTo(1.01, 3)
    expect(out.targets?.IBU).toBeCloseTo(40, 5)
    expect(out.targets?.SRM).toBeCloseTo(6, 5)
    expect(out.yeasts[0].pitchTemp_C).toBeCloseTo(18, 5)
    expect(out.mashSteps[0].waterAmount_L).toBeCloseTo(15, 5)
    expect(out.mashSteps[0].rampTime_min).toBeCloseTo(2, 5)
  })
})

describe('serializeBeerXML (bug 9: correct BeerXML casing on export)', () => {
  it('emits title-case USE/TYPE/FORM for strict consumers', () => {
    const r = baseRecipe({
      hops: [
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440201',
          snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' },
          amount_g: 28,
          time_min: 0,
          use: 'dry-hop',
        },
      ],
      miscs: [
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440401',
          snapshot: { name: 'Gypsum', type: 'water-agent' },
          amount: 2,
          amountUnit: 'g',
          use: 'primary',
          time_min: 0,
        },
      ],
    })
    const xml = serializeBeerXML([r])
    expect(xml).toContain('<TYPE>All Grain</TYPE>')
    expect(xml).toContain('<USE>Dry Hop</USE>')
    expect(xml).toContain('<FORM>Pellet</FORM>')
    expect(xml).toContain('<USE>Primary</USE>')
    expect(xml).toContain('<FORM>Dry</FORM>') // yeast form
  })
})

describe('round-trip (units: BeerXML kilograms <-> grams for hops)', () => {
  it('keeps hop grams stable through kg conversion', () => {
    const out = roundTrip(baseRecipe())
    expect(out.hops[0].amount_g).toBeCloseTo(28, 0)
    expect(out.fermentables[0].amount_kg).toBeCloseTo(4.5, 3)
  })
})
