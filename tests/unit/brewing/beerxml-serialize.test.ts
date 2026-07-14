import { describe, expect, it } from 'vitest'
import { parseBeerXML } from '@/lib/brewing/beerxml/parse'
import { serializeBeerXML } from '@/lib/brewing/beerxml/serialize'
import type { Recipe } from '@/lib/brewing/types/recipe'

const sampleRecipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
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
}

describe('serializeBeerXML', () => {
  it('produces XML string with RECIPES root', () => {
    const xml = serializeBeerXML([sampleRecipe])
    expect(xml).toContain('<RECIPES>')
    expect(xml).toContain('<NAME>SMaSH</NAME>')
  })

  it('round-trips parse → serialize → parse', () => {
    const xml = serializeBeerXML([sampleRecipe])
    const reparsed = parseBeerXML(xml)
    expect(reparsed).toHaveLength(1)
    expect(reparsed[0].name).toBe(sampleRecipe.name)
    expect(reparsed[0].fermentables).toHaveLength(1)
    expect(reparsed[0].fermentables[0].snapshot.name).toBe('2-Row Pale')
    expect(reparsed[0].hops).toHaveLength(1)
    expect(reparsed[0].mashSteps).toHaveLength(1)
  })
})
