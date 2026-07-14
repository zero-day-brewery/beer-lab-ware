import { XMLBuilder } from 'fast-xml-parser'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { MiscUse } from '@/lib/brewing/types/recipe-parts'

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function recipeTypeToBeerXML(t: Recipe['type']): string {
  if (t === 'all-grain') return 'All Grain'
  if (t === 'partial-mash') return 'Partial Mash'
  return titleCase(t)
}

function fermentableTypeToBeerXML(t: Recipe['fermentables'][number]['snapshot']['type']): string {
  // BeerXML fermentable TYPE enum: Grain, Sugar, Extract, Dry Extract, Adjunct.
  if (t === 'base' || t === 'specialty') return 'Grain'
  return titleCase(t)
}

function hopUseToBeerXML(use: Recipe['hops'][number]['use']): string {
  // BeerXML hop USE enum: Boil, Dry Hop, Mash, First Wort, Aroma.
  if (use === 'first-wort') return 'First Wort'
  if (use === 'dry-hop') return 'Dry Hop'
  if (use === 'whirlpool') return 'Aroma'
  return titleCase(use)
}

function miscUseToBeerXML(use: MiscUse['use']): string {
  // BeerXML misc USE enum: Boil, Mash, Primary, Secondary, Bottling.
  return titleCase(use)
}

export function serializeBeerXML(recipes: Recipe[]): string {
  const builder = new XMLBuilder({
    ignoreAttributes: true,
    format: true,
    indentBy: '  ',
    processEntities: true,
    suppressEmptyNode: false,
  })

  const obj = {
    RECIPES: {
      RECIPE: recipes.map((r) => {
        const recipe: Record<string, unknown> = {
          NAME: r.name,
          VERSION: 1,
          TYPE: recipeTypeToBeerXML(r.type),
          BREWER: 'Homebrewer',
          BATCH_SIZE: r.batchSize_L,
          BOIL_TIME: r.boilTime_min,
          EFFICIENCY: 72,
          NOTES: r.notes_md,
          FERMENTABLES: {
            FERMENTABLE: r.fermentables.map((f) => ({
              NAME: f.snapshot.name,
              VERSION: 1,
              TYPE: fermentableTypeToBeerXML(f.snapshot.type),
              AMOUNT: f.amount_kg,
              YIELD: Math.round(f.snapshot.ppg / 0.46),
              COLOR: f.snapshot.color_L,
            })),
          },
          HOPS: {
            HOP: r.hops.map((h) => ({
              NAME: h.snapshot.name,
              VERSION: 1,
              ALPHA: h.snapshot.alphaAcid_pct,
              AMOUNT: h.amount_g / 1000,
              USE: hopUseToBeerXML(h.use),
              TIME: h.time_min,
              FORM: titleCase(h.snapshot.form),
            })),
          },
          YEASTS: {
            YEAST: r.yeasts.map((y) => {
              const yeast: Record<string, unknown> = {
                NAME: y.snapshot.name,
                VERSION: 1,
                TYPE: 'Ale',
                FORM: titleCase(y.snapshot.form),
                // Standard single value for strict consumers...
                ATTENUATION: (y.snapshot.attenuation_min_pct + y.snapshot.attenuation_max_pct) / 2,
                // ...plus the faithful range so our own round-trip is lossless.
                MIN_ATTENUATION: y.snapshot.attenuation_min_pct,
                MAX_ATTENUATION: y.snapshot.attenuation_max_pct,
                AMOUNT: y.amount / 1000,
              }
              if (y.pitchTemp_C !== undefined) {
                yeast.PITCH_TEMP = y.pitchTemp_C
                yeast.DISP_MIN_TEMP = y.pitchTemp_C
              }
              return yeast
            }),
          },
          MISCS:
            r.miscs.length === 0
              ? ''
              : {
                  MISC: r.miscs.map((m) => ({
                    NAME: m.snapshot.name,
                    VERSION: 1,
                    TYPE: 'Other',
                    USE: miscUseToBeerXML(m.use),
                    AMOUNT: m.amount,
                    AMOUNT_UNIT: m.amountUnit,
                    TIME: m.time_min,
                  })),
                },
          MASH: {
            NAME: 'Mash',
            VERSION: 1,
            MASH_STEPS: {
              MASH_STEP: r.mashSteps.map((s) => {
                const step: Record<string, unknown> = {
                  NAME: s.name,
                  VERSION: 1,
                  TYPE: titleCase(s.type),
                  STEP_TEMP: s.temperature_C,
                  STEP_TIME: s.time_min,
                }
                if (s.rampTime_min !== undefined) step.RAMP_TIME = s.rampTime_min
                if (s.waterAmount_L !== undefined) step.INFUSE_AMOUNT = s.waterAmount_L
                return step
              }),
            },
          },
        }

        if (r.styleId !== undefined) recipe.STYLE_ID = r.styleId
        if (r.targets) {
          const t = r.targets
          if (t.OG !== undefined) recipe.EST_OG = t.OG
          if (t.FG !== undefined) recipe.EST_FG = t.FG
          if (t.ABV !== undefined) recipe.EST_ABV = t.ABV
          if (t.IBU !== undefined) recipe.IBU = t.IBU
          if (t.SRM !== undefined) recipe.EST_COLOR = t.SRM
        }

        return recipe
      }),
    },
  }

  return builder.build(obj) as string
}
