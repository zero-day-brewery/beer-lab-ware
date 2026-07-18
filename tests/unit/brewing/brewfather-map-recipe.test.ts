import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapBrewfatherRecipe } from '@/lib/brewing/brewfather/map-recipe'
import { RecipeSchema } from '@/lib/brewing/types/recipe'

const NOW = '2026-07-17T10:00:00.000Z'

function loadFixture(name: string): unknown[] {
  const file = path.join(__dirname, '../../fixtures/brewfather', name)
  return JSON.parse(readFileSync(file, 'utf-8'))
}

const hazy = () => loadFixture('recipes.json')[0]

describe('mapBrewfatherRecipe', () => {
  it('maps the full fixture recipe to a schema-valid app Recipe', () => {
    const { recipe, warnings } = mapBrewfatherRecipe(hazy(), { now: NOW })
    expect(recipe).not.toBeNull()
    const r = RecipeSchema.parse(recipe)

    expect(r.name).toBe('Hazy Horizon IPA')
    expect(r.type).toBe('all-grain')
    expect(r.batchSize_L).toBe(20)
    expect(r.boilTime_min).toBe(60)
    expect(r.tags).toEqual(['ipa', 'hazy'])
    expect(r.styleId).toBe('Hazy IPA')
    expect(r.notes_md).toContain('Pillowy NEIPA')
    expect(r.createdAt).toBe('2025-01-01T00:00:00.000Z') // epoch-ms `created`
    expect(r.updatedAt).toBe(NOW)

    // Warnings mention the unsupported sections, but nothing else broke.
    expect(warnings.join('\n')).toMatch(/unsupported sections.*equipment, fermentation, water/)
  })

  it('maps targets: OG/FG/ABV/IBU direct, SRM converted from EBC', () => {
    const { recipe } = mapBrewfatherRecipe(hazy(), { now: NOW })
    expect(recipe?.targets).toBeDefined()
    expect(recipe?.targets?.OG).toBe(1.062)
    expect(recipe?.targets?.FG).toBe(1.014)
    expect(recipe?.targets?.ABV).toBe(6.3)
    expect(recipe?.targets?.IBU).toBe(45)
    // 11.8 EBC / 1.97 ≈ 6.0 SRM
    expect(recipe?.targets?.SRM).toBeCloseTo(6.0, 1)
  })

  it('maps fermentables: kg amounts, ppg from potential OR yield %, Lovibond color', () => {
    const { recipe, warnings } = mapBrewfatherRecipe(hazy(), { now: NOW })
    const [pale, oats, honey] = recipe?.fermentables ?? []

    expect(pale.snapshot.name).toBe('Pale Ale Malt')
    expect(pale.snapshot.type).toBe('base')
    expect(pale.amount_kg).toBe(4.5)
    expect(pale.snapshot.ppg).toBe(37) // (1.037 - 1) * 1000
    expect(pale.snapshot.color_L).toBe(3.5)

    expect(oats.snapshot.type).toBe('adjunct')
    expect(oats.snapshot.ppg).toBe(32) // 70% * 0.46
    expect(oats.snapshot.color_L).toBe(2.2) // explicit lovibond field wins

    // Honey has no potential at all → defaulted ppg + a warning.
    expect(honey.snapshot.type).toBe('sugar')
    expect(honey.snapshot.ppg).toBeGreaterThan(0)
    expect(warnings.join('\n')).toMatch(/Wildflower Honey.*ppg defaulted/)
  })

  it('maps hops: uses, forms, and refuses to guess dry-hop duration units', () => {
    const { recipe, warnings } = mapBrewfatherRecipe(hazy(), { now: NOW })
    const [boil, whirlpool, dryHop] = recipe?.hops ?? []

    expect(boil.use).toBe('boil')
    expect(boil.amount_g).toBe(20)
    expect(boil.time_min).toBe(10)
    expect(boil.snapshot.alphaAcid_pct).toBe(12.5)

    expect(whirlpool.use).toBe('whirlpool') // Brewfather "Aroma"
    expect(dryHop.use).toBe('dry-hop')
    expect(dryHop.snapshot.form).toBe('cryo')
    expect(dryHop.time_min).toBe(0) // ambiguous units — not imported
    expect(warnings.join('\n')).toMatch(/dry-hop duration units are ambiguous/)
  })

  it('maps yeast (pkg count warned) and miscs (items → each)', () => {
    const { recipe, warnings } = mapBrewfatherRecipe(hazy(), { now: NOW })
    const yeast = recipe?.yeasts[0]
    expect(yeast?.snapshot.name).toBe('London Ale III')
    expect(yeast?.snapshot.form).toBe('liquid')
    expect(yeast?.snapshot.attenuation_min_pct).toBe(72)
    expect(yeast?.snapshot.attenuation_max_pct).toBe(78)
    expect(warnings.join('\n')).toMatch(/packages.*stored as a count/)

    const [cacl, whirlfloc] = recipe?.miscs ?? []
    expect(cacl.snapshot.type).toBe('water-agent')
    expect(cacl.use).toBe('mash')
    expect(whirlfloc.amountUnit).toBe('each')
    expect(whirlfloc.use).toBe('boil')
    expect(whirlfloc.time_min).toBe(15)
  })

  it('maps mash steps with °C temps and ramp times', () => {
    const { recipe } = mapBrewfatherRecipe(hazy(), { now: NOW })
    const [sacc, mashOut] = recipe?.mashSteps ?? []
    expect(sacc.name).toBe('Saccharification')
    expect(sacc.type).toBe('temperature')
    expect(sacc.temperature_C).toBe(67)
    expect(sacc.time_min).toBe(60)
    expect(mashOut.rampTime_min).toBe(7)
  })

  it('derives a stable uuid from the Brewfather _id (idempotent re-import)', () => {
    const a = mapBrewfatherRecipe(hazy(), { now: NOW })
    const b = mapBrewfatherRecipe(hazy(), { now: '2027-01-01T00:00:00.000Z' })
    expect(a.recipe?.id).toBe(b.recipe?.id)
    expect(a.recipe?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('skips a recipe with no positive batch size, with a warning', () => {
    const { recipe, warnings } = mapBrewfatherRecipe(
      { _id: 'x', name: 'No Size', type: 'All Grain' },
      { now: NOW },
    )
    expect(recipe).toBeNull()
    expect(warnings.join('\n')).toMatch(/batch size missing/)
  })

  it('defaults a missing name with a warning instead of failing', () => {
    const { recipe, warnings } = mapBrewfatherRecipe({ _id: 'x', batchSize: 20 }, { now: NOW })
    expect(recipe?.name).toBe('Untitled Recipe')
    expect(warnings.join('\n')).toMatch(/name missing/)
  })

  it('treats wrong-typed fields as missing instead of failing the entity', () => {
    const { recipe } = mapBrewfatherRecipe(
      { _id: 'x', name: 42, batchSize: 20, boilTime: 'sixty', hops: 'nope' },
      { now: NOW },
    )
    expect(recipe).not.toBeNull()
    expect(recipe?.name).toBe('Untitled Recipe')
    expect(recipe?.boilTime_min).toBe(0)
    expect(recipe?.hops).toEqual([])
  })

  it('skips a non-object entity with a warning', () => {
    const { recipe, warnings } = mapBrewfatherRecipe('garbage', { now: NOW })
    expect(recipe).toBeNull()
    expect(warnings).toHaveLength(1)
  })

  it('skips malformed ingredient lines but keeps the rest of the recipe', () => {
    const { recipe, warnings } = mapBrewfatherRecipe(
      {
        _id: 'x',
        name: 'Mixed',
        batchSize: 20,
        boilTime: 60,
        fermentables: [
          { name: 'Good Malt', amount: 4, potential: 1.037, color: 3 },
          'not-a-fermentable',
        ],
      },
      { now: NOW },
    )
    expect(recipe?.fermentables).toHaveLength(1)
    expect(warnings.join('\n')).toMatch(/fermentable #2 skipped/)
  })
})
