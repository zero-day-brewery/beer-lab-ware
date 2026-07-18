import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBrewfatherFile } from '@/lib/brewing/brewfather/classify'
import { buildBrewfatherPlan } from '@/lib/brewing/brewfather/import'

const NOW = '2026-07-17T10:00:00.000Z'
const FIXTURES = path.join(__dirname, '../../fixtures/brewfather')

function fixture(name: string): { fileName: string; text: string } {
  return { fileName: name, text: readFileSync(path.join(FIXTURES, name), 'utf-8') }
}

describe('parseBrewfatherFile', () => {
  it('classifies by file name for inventory files', () => {
    const parsed = parseBrewfatherFile('hops.json', fixture('hops.json').text)
    expect(parsed.entities.map((e) => e.kind)).toEqual(['hop', 'hop'])
  })

  it('classifies batches by content even without a file-name hint', () => {
    const parsed = parseBrewfatherFile('export.json', fixture('batches.json').text)
    expect(parsed.entities.map((e) => e.kind)).toEqual(['batch', 'batch'])
  })

  it('classifies recipes by content without a hint', () => {
    const parsed = parseBrewfatherFile('mystuff.json', fixture('recipes.json').text)
    expect(parsed.entities.map((e) => e.kind)).toEqual(['recipe'])
  })

  it('wraps a single-entity export (one recipe object, not an array)', () => {
    const one = JSON.parse(fixture('recipes.json').text)[0]
    const parsed = parseBrewfatherFile('hazy.json', JSON.stringify(one))
    expect(parsed.entities.map((e) => e.kind)).toEqual(['recipe'])
  })

  it('flattens a container object ({ recipes: [...], hops: [...] })', () => {
    const container = {
      recipes: JSON.parse(fixture('recipes.json').text),
      hops: JSON.parse(fixture('hops.json').text),
    }
    const parsed = parseBrewfatherFile('all.json', JSON.stringify(container))
    expect(parsed.entities.map((e) => e.kind).sort()).toEqual(['hop', 'hop', 'recipe'])
  })

  it('invalid JSON skips the file with a warning, not a throw', () => {
    const parsed = parseBrewfatherFile('broken.json', '{ not json')
    expect(parsed.entities).toHaveLength(0)
    expect(parsed.warnings.join('\n')).toMatch(/broken\.json.*not valid JSON/)
  })

  it('a non-object entity inside a valid file is skipped with a warning', () => {
    const parsed = parseBrewfatherFile('recipes.json', fixture('malformed-recipes.json').text)
    expect(parsed.entities).toHaveLength(2) // good + no-batch-size (mapper skips that one later)
    expect(parsed.warnings.join('\n')).toMatch(/Entity #2 skipped/)
  })
})

describe('buildBrewfatherPlan (dry-run preview)', () => {
  const allFiles = () => [
    fixture('recipes.json'),
    fixture('batches.json'),
    fixture('fermentables.json'),
    fixture('hops.json'),
    fixture('yeasts.json'),
    fixture('miscs.json'),
  ]

  it('counts every mappable entity across files without writing anything', () => {
    const plan = buildBrewfatherPlan(allFiles(), { now: NOW })
    expect(plan.counts.recipes).toBe(1)
    expect(plan.counts.batches).toBe(2)
    expect(plan.counts.readings).toBe(4) // 3 usable + 1 on the fermenting batch
    // 3 fermentables + 2 hops + 2 yeasts + 2 miscs (vanilla tsp skipped)
    expect(plan.counts.inventoryItems).toBe(9)
    expect(plan.skippedEntities).toBe(1) // the tsp misc
  })

  it('collects warnings instead of failing on a malformed entity', () => {
    const plan = buildBrewfatherPlan([fixture('malformed-recipes.json')], { now: NOW })
    expect(plan.counts.recipes).toBe(1) // only the good one
    expect(plan.skippedEntities).toBe(2) // the string + the no-batch-size recipe
    expect(plan.warnings.join('\n')).toMatch(/Entity #2 skipped/)
    expect(plan.warnings.join('\n')).toMatch(/No Batch Size Porter.*batch size missing/)
  })

  it('dedupes the same file selected twice (stable ids)', () => {
    const plan = buildBrewfatherPlan([fixture('recipes.json'), fixture('recipes.json')], {
      now: NOW,
    })
    expect(plan.counts.recipes).toBe(1)
  })

  it('is deterministic: two runs produce identical ids', () => {
    const a = buildBrewfatherPlan(allFiles(), { now: NOW })
    const b = buildBrewfatherPlan(allFiles(), { now: NOW })
    expect(a.recipes.map((r) => r.id)).toEqual(b.recipes.map((r) => r.id))
    expect(a.batches.map((p) => p.batch.id)).toEqual(b.batches.map((p) => p.batch.id))
    expect(a.inventory.map((i) => i.item.id)).toEqual(b.inventory.map((i) => i.item.id))
  })
})
