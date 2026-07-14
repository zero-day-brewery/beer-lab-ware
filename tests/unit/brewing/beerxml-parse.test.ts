import { describe, expect, it } from 'vitest'
import { parseBeerXML } from '@/lib/brewing/beerxml/parse'

const sampleXML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<RECIPES>
  <RECIPE>
    <NAME>SMaSH Pale Ale</NAME>
    <VERSION>1</VERSION>
    <TYPE>All Grain</TYPE>
    <BREWER>Homebrewer</BREWER>
    <BATCH_SIZE>19</BATCH_SIZE>
    <BOIL_SIZE>23.83</BOIL_SIZE>
    <BOIL_TIME>60</BOIL_TIME>
    <EFFICIENCY>72</EFFICIENCY>
    <NOTES>First SMaSH</NOTES>
    <FERMENTABLES>
      <FERMENTABLE>
        <NAME>2-Row Pale</NAME>
        <VERSION>1</VERSION>
        <TYPE>Grain</TYPE>
        <AMOUNT>4.5</AMOUNT>
        <YIELD>80</YIELD>
        <COLOR>2</COLOR>
      </FERMENTABLE>
    </FERMENTABLES>
    <HOPS>
      <HOP>
        <NAME>Cascade</NAME>
        <VERSION>1</VERSION>
        <ALPHA>5.5</ALPHA>
        <AMOUNT>0.028</AMOUNT>
        <USE>Boil</USE>
        <TIME>60</TIME>
        <FORM>Pellet</FORM>
      </HOP>
    </HOPS>
    <YEASTS>
      <YEAST>
        <NAME>US-05</NAME>
        <VERSION>1</VERSION>
        <TYPE>Ale</TYPE>
        <FORM>Dry</FORM>
        <ATTENUATION>78</ATTENUATION>
        <AMOUNT>0.0115</AMOUNT>
      </YEAST>
    </YEASTS>
    <MISCS />
    <MASH>
      <NAME>Single Infusion</NAME>
      <VERSION>1</VERSION>
      <MASH_STEPS>
        <MASH_STEP>
          <NAME>Saccharification</NAME>
          <VERSION>1</VERSION>
          <TYPE>Infusion</TYPE>
          <STEP_TEMP>66</STEP_TEMP>
          <STEP_TIME>60</STEP_TIME>
        </MASH_STEP>
      </MASH_STEPS>
    </MASH>
  </RECIPE>
</RECIPES>`

describe('parseBeerXML', () => {
  it('parses a minimal BeerXML recipe', () => {
    const recipes = parseBeerXML(sampleXML)
    expect(recipes).toHaveLength(1)
    const r = recipes[0]
    expect(r.name).toBe('SMaSH Pale Ale')
    expect(r.type).toBe('all-grain')
    expect(r.batchSize_L).toBe(19)
    expect(r.boilTime_min).toBe(60)
    expect(r.fermentables).toHaveLength(1)
    expect(r.fermentables[0].snapshot.name).toBe('2-Row Pale')
    expect(r.fermentables[0].amount_kg).toBe(4.5)
    expect(r.hops).toHaveLength(1)
    expect(r.hops[0].snapshot.name).toBe('Cascade')
    expect(r.hops[0].amount_g).toBeCloseTo(28, 0)
    expect(r.yeasts).toHaveLength(1)
    expect(r.yeasts[0].snapshot.name).toBe('US-05')
    expect(r.mashSteps).toHaveLength(1)
    expect(r.mashSteps[0].temperature_C).toBe(66)
  })

  it('handles empty MISCS gracefully', () => {
    const recipes = parseBeerXML(sampleXML)
    expect(recipes[0].miscs).toEqual([])
  })
})
