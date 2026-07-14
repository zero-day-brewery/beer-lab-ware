import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFixture } from '@/lib/brewing/calc/fixture-loader'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'reference-recipes')

const TOLERANCES = {
  OG: 0.002,
  FG: 0.002,
  ABV: 0.2,
  IBU: 1.5,
  SRM: 0.5,
}

function listFixtureDirs(): string[] {
  try {
    return readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    return []
  }
}

describe('reference fixtures', () => {
  const fixtures = listFixtureDirs()

  it('fixture directory exists', () => {
    expect(fixtures).toBeDefined()
  })

  for (const name of fixtures) {
    it(`fixture: ${name}`, () => {
      const { recipe, equipment, expected } = loadFixture(join(FIXTURES_DIR, name))
      const actual = calculateRecipe(recipe, equipment, '2026-05-12T00:00:00.000Z')

      expect(Math.abs(actual.OG - expected.OG)).toBeLessThan(TOLERANCES.OG)
      expect(Math.abs(actual.FG - expected.FG)).toBeLessThan(TOLERANCES.FG)
      expect(Math.abs(actual.ABV - expected.ABV)).toBeLessThan(TOLERANCES.ABV)
      expect(Math.abs(actual.IBU - expected.IBU)).toBeLessThan(TOLERANCES.IBU)
      expect(Math.abs(actual.SRM - expected.SRM)).toBeLessThan(TOLERANCES.SRM)
    })
  }
})
