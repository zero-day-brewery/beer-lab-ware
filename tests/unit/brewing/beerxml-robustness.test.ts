import { describe, expect, it } from 'vitest'
import { parseBeerXML } from '@/lib/brewing/beerxml/parse'
import { RecipeSchema } from '@/lib/brewing/types/recipe'

/**
 * Robustness + fidelity regression tests for the BeerXML importer.
 * Each case mirrors a confirmed audit bug: malformed / partial real-world
 * exports that previously crashed the import or silently lost data.
 */

function wrap(inner: string): string {
  return `<?xml version="1.0" encoding="ISO-8859-1"?><RECIPES><RECIPE>${inner}</RECIPE></RECIPES>`
}

const minimalBody = `
  <NAME>Test</NAME>
  <TYPE>All Grain</TYPE>
  <BATCH_SIZE>19</BATCH_SIZE>
  <BOIL_TIME>60</BOIL_TIME>
`

describe('parseBeerXML — robustness (bug 1: numeric NAME coercion)', () => {
  it('keeps a purely-numeric recipe NAME as a string', () => {
    const xml = wrap(`
      <NAME>2024</NAME>
      <TYPE>All Grain</TYPE>
      <BATCH_SIZE>19</BATCH_SIZE>
      <BOIL_TIME>60</BOIL_TIME>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes).toHaveLength(1)
    expect(recipes[0].name).toBe('2024')
    expect(typeof recipes[0].name).toBe('string')
    // Must survive schema validation (name: string min(1)).
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })

  it('keeps numeric ingredient names as strings', () => {
    const xml = wrap(`
      ${minimalBody}
      <FERMENTABLES><FERMENTABLE>
        <NAME>2024</NAME><TYPE>Grain</TYPE><AMOUNT>4.5</AMOUNT><YIELD>80</YIELD><COLOR>2</COLOR>
      </FERMENTABLE></FERMENTABLES>
      <HOPS><HOP>
        <NAME>2020</NAME><ALPHA>5.5</ALPHA><AMOUNT>0.028</AMOUNT><USE>Boil</USE><TIME>60</TIME><FORM>Pellet</FORM>
      </HOP></HOPS>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].fermentables[0].snapshot.name).toBe('2024')
    expect(typeof recipes[0].fermentables[0].snapshot.name).toBe('string')
    expect(recipes[0].hops[0].snapshot.name).toBe('2020')
    expect(typeof recipes[0].hops[0].snapshot.name).toBe('string')
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })
})

describe('parseBeerXML — robustness (bug 2: missing TYPE/USE/FORM defaults)', () => {
  it('does not throw when recipe TYPE is missing', () => {
    const xml = wrap(`
      <NAME>NoType</NAME>
      <BATCH_SIZE>19</BATCH_SIZE>
      <BOIL_TIME>60</BOIL_TIME>
    `)
    expect(() => parseBeerXML(xml)).not.toThrow()
    expect(parseBeerXML(xml)[0].type).toBe('all-grain')
  })

  it('defaults missing hop USE→boil and FORM→pellet without throwing', () => {
    const xml = wrap(`
      ${minimalBody}
      <HOPS><HOP>
        <NAME>Citra</NAME><ALPHA>12</ALPHA><AMOUNT>0.02</AMOUNT><TIME>10</TIME>
      </HOP></HOPS>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].hops[0].use).toBe('boil')
    expect(recipes[0].hops[0].snapshot.form).toBe('pellet')
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })

  it('defaults missing fermentable TYPE→base without throwing', () => {
    const xml = wrap(`
      ${minimalBody}
      <FERMENTABLES><FERMENTABLE>
        <NAME>Mystery Malt</NAME><AMOUNT>4.5</AMOUNT><YIELD>80</YIELD><COLOR>2</COLOR>
      </FERMENTABLE></FERMENTABLES>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].fermentables[0].snapshot.type).toBe('base')
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })

  it('defaults missing mash step TYPE→infusion without throwing', () => {
    const xml = wrap(`
      ${minimalBody}
      <MASH><MASH_STEPS><MASH_STEP>
        <NAME>Sacc</NAME><STEP_TEMP>66</STEP_TEMP><STEP_TIME>60</STEP_TIME>
      </MASH_STEP></MASH_STEPS></MASH>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].mashSteps[0].type).toBe('infusion')
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })

  it('defaults missing misc USE→boil without throwing', () => {
    const xml = wrap(`
      ${minimalBody}
      <MISCS><MISC>
        <NAME>Irish Moss</NAME><AMOUNT>0.005</AMOUNT><TIME>15</TIME>
      </MISC></MISCS>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].miscs[0].use).toBe('boil')
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })

  it('defaults missing yeast FORM→dry without throwing', () => {
    const xml = wrap(`
      ${minimalBody}
      <YEASTS><YEAST>
        <NAME>US-05</NAME><ATTENUATION>78</ATTENUATION><AMOUNT>0.0115</AMOUNT>
      </YEAST></YEASTS>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].yeasts[0].snapshot.form).toBe('dry')
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })
})

describe('parseBeerXML — robustness (bug 3: missing YIELD → NaN ppg)', () => {
  it('never emits NaN ppg when YIELD is missing', () => {
    const xml = wrap(`
      ${minimalBody}
      <FERMENTABLES><FERMENTABLE>
        <NAME>No Yield Malt</NAME><TYPE>Grain</TYPE><AMOUNT>4.5</AMOUNT><COLOR>2</COLOR>
      </FERMENTABLE></FERMENTABLES>
    `)
    const recipes = parseBeerXML(xml)
    const ppg = recipes[0].fermentables[0].snapshot.ppg
    expect(Number.isNaN(ppg)).toBe(false)
    expect(ppg).toBeGreaterThan(0)
    // ~75% yield → ~37 ppg default.
    expect(ppg).toBeGreaterThanOrEqual(34)
    expect(ppg).toBeLessThanOrEqual(40)
    expect(() => RecipeSchema.parse(recipes[0])).not.toThrow()
  })
})

describe('parseBeerXML — case-insensitive enums (bug 9 import side)', () => {
  it('parses lowercase / mixed-case USE + TYPE + FORM', () => {
    const xml = wrap(`
      <NAME>Cased</NAME>
      <TYPE>all grain</TYPE>
      <BATCH_SIZE>19</BATCH_SIZE>
      <BOIL_TIME>60</BOIL_TIME>
      <HOPS><HOP>
        <NAME>Citra</NAME><ALPHA>12</ALPHA><AMOUNT>0.02</AMOUNT><USE>dry hop</USE><TIME>0</TIME><FORM>PELLET</FORM>
      </HOP></HOPS>
    `)
    const recipes = parseBeerXML(xml)
    expect(recipes[0].type).toBe('all-grain')
    expect(recipes[0].hops[0].use).toBe('dry-hop')
    expect(recipes[0].hops[0].snapshot.form).toBe('pellet')
  })
})
