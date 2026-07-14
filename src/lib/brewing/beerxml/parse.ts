import { XMLParser } from 'fast-xml-parser'
import type { Recipe, RecipeType, Targets } from '@/lib/brewing/types/recipe'
import type {
  FermentableUse,
  HopUse,
  MashStep,
  MiscUse,
  YeastUse,
} from '@/lib/brewing/types/recipe-parts'
import { newId } from '@/lib/utils/id'

interface RawRecipe {
  NAME?: string | number
  TYPE?: string
  STYLE?: { NAME?: string | number }
  STYLE_ID?: string | number
  BATCH_SIZE?: number
  BOIL_TIME?: number
  EFFICIENCY?: number
  EST_OG?: number
  EST_FG?: number
  ABV?: number
  EST_ABV?: number
  IBU?: number
  EST_COLOR?: number
  NOTES?: string
  FERMENTABLES?: { FERMENTABLE: RawFermentable | RawFermentable[] }
  HOPS?: { HOP: RawHop | RawHop[] }
  YEASTS?: { YEAST: RawYeast | RawYeast[] }
  MISCS?: { MISC: RawMisc | RawMisc[] } | string
  MASH?: { MASH_STEPS?: { MASH_STEP: RawMashStep | RawMashStep[] } | string }
}

interface RawFermentable {
  NAME?: string | number
  TYPE?: string
  AMOUNT?: number
  YIELD?: number
  COLOR?: number
}
interface RawHop {
  NAME?: string | number
  ALPHA?: number
  AMOUNT?: number
  USE?: string
  TIME?: number
  FORM?: string
}
interface RawYeast {
  NAME?: string | number
  TYPE?: string
  FORM?: string
  ATTENUATION?: number
  MIN_ATTENUATION?: number
  MAX_ATTENUATION?: number
  AMOUNT?: number
  CULTURE_DATE?: string
  PITCH_TEMP?: number
  DISP_MIN_TEMP?: number
}
interface RawMisc {
  NAME?: string | number
  TYPE?: string
  USE?: string
  AMOUNT?: number
  TIME?: number
  AMOUNT_UNIT?: string
  DISPLAY_AMOUNT?: string
}
interface RawMashStep {
  NAME?: string | number
  TYPE?: string
  STEP_TEMP?: number
  STEP_TIME?: number
  RAMP_TIME?: number
  INFUSE_AMOUNT?: number
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * `parseTagValue: true` coerces purely-numeric tags (e.g. `<NAME>2024</NAME>`)
 * into JS numbers. Names must stay strings — coerce defensively. Empty/undefined
 * tags become the empty string so they never blow up `.toLowerCase()`.
 */
function asString(v: string | number | undefined): string {
  if (v === undefined || v === null) return ''
  return String(v)
}

/** Coerce to a finite number, falling back to `fallback` for NaN/undefined. */
function asNumber(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function mapRecipeType(raw: string | undefined): RecipeType {
  const lower = asString(raw).toLowerCase()
  if (lower === 'all grain') return 'all-grain'
  if (lower === 'extract') return 'extract'
  if (lower === 'partial mash') return 'partial-mash'
  if (lower === 'cider') return 'cider'
  if (lower === 'mead') return 'mead'
  return 'all-grain'
}

function mapFermentableType(raw: string | undefined): FermentableUse['snapshot']['type'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'grain') return 'base'
  if (lower === 'sugar') return 'sugar'
  if (lower === 'extract' || lower === 'dry extract') return 'extract'
  if (lower === 'adjunct') return 'adjunct'
  if (lower === '') return 'base'
  return 'specialty'
}

function mapHopUse(raw: string | undefined): HopUse['use'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'first wort' || lower === 'first-wort') return 'first-wort'
  if (lower === 'whirlpool' || lower === 'aroma') return 'whirlpool'
  if (lower === 'dry hop' || lower === 'dry-hop' || lower === 'fermentor') return 'dry-hop'
  if (lower === 'mash') return 'mash'
  return 'boil'
}

function mapHopForm(raw: string | undefined): HopUse['snapshot']['form'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'leaf' || lower === 'whole') return 'leaf'
  if (lower === 'plug') return 'plug'
  if (lower === 'extract') return 'extract'
  if (lower === 'cryo') return 'cryo'
  return 'pellet'
}

function mapYeastForm(raw: string | undefined): YeastUse['snapshot']['form'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'liquid') return 'liquid'
  if (lower === 'slant') return 'slant'
  if (lower === 'culture') return 'culture'
  return 'dry'
}

function mapMashType(raw: string | undefined): MashStep['type'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'temperature') return 'temperature'
  if (lower === 'decoction') return 'decoction'
  return 'infusion'
}

function mapMiscUse(raw: string | undefined): MiscUse['use'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'mash') return 'mash'
  if (lower === 'primary') return 'primary'
  if (lower === 'secondary') return 'secondary'
  if (lower === 'bottling') return 'bottling'
  return 'boil'
}

function mapMiscUnit(raw: string | undefined): MiscUse['amountUnit'] {
  const lower = asString(raw).toLowerCase()
  if (lower === 'ml') return 'ml'
  if (lower === 'tsp') return 'tsp'
  if (lower === 'tbsp') return 'tbsp'
  if (lower === 'each' || lower === 'items' || lower === 'item') return 'each'
  return 'g'
}

/**
 * BeerXML YIELD is a percentage (% extract by weight). ppg ~= YIELD * 0.46.
 * Missing/zero YIELD is treated as a sane ~75% default (≈ 37 ppg) so we never
 * persist a NaN or non-positive ppg (the schema requires positive).
 */
const DEFAULT_YIELD_PCT = 75
function yieldToPpg(rawYield: number | undefined): number {
  const y = asNumber(rawYield, DEFAULT_YIELD_PCT)
  const usable = y > 0 ? y : DEFAULT_YIELD_PCT
  const ppg = Math.round(usable * 0.46)
  return ppg > 0 ? ppg : Math.round(DEFAULT_YIELD_PCT * 0.46)
}

function buildTargets(r: RawRecipe): Targets | undefined {
  const t: Targets = {}
  if (Number.isFinite(r.EST_OG)) t.OG = r.EST_OG
  if (Number.isFinite(r.EST_FG)) t.FG = r.EST_FG
  const abv = Number.isFinite(r.ABV) ? r.ABV : r.EST_ABV
  if (Number.isFinite(abv)) t.ABV = abv
  if (Number.isFinite(r.IBU)) t.IBU = r.IBU
  if (Number.isFinite(r.EST_COLOR)) t.SRM = r.EST_COLOR
  return Object.keys(t).length > 0 ? t : undefined
}

export function parseBeerXML(xml: string): Recipe[] {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: true })
  const parsed = parser.parse(xml) as { RECIPES?: { RECIPE: RawRecipe | RawRecipe[] } }
  const raw = toArray(parsed.RECIPES?.RECIPE)
  const now = new Date().toISOString()

  return raw.map((r) => {
    const fermentables: FermentableUse[] = toArray(r.FERMENTABLES?.FERMENTABLE).map((f) => ({
      ingredientId: newId(),
      snapshot: {
        name: asString(f.NAME),
        type: mapFermentableType(f.TYPE),
        ppg: yieldToPpg(f.YIELD),
        color_L: asNumber(f.COLOR, 0),
      },
      amount_kg: asNumber(f.AMOUNT, 0),
      usage: 'mash' as const,
      afterBoil: false,
    }))

    const hops: HopUse[] = toArray(r.HOPS?.HOP).map((h) => ({
      ingredientId: newId(),
      snapshot: {
        name: asString(h.NAME),
        alphaAcid_pct: asNumber(h.ALPHA, 0),
        form: mapHopForm(h.FORM),
      },
      amount_g: Math.round(asNumber(h.AMOUNT, 0) * 1000),
      time_min: asNumber(h.TIME, 0),
      use: mapHopUse(h.USE),
    }))

    const yeasts: YeastUse[] = toArray(r.YEASTS?.YEAST).map((y) => {
      // Prefer an explicit min/max range; fall back to a single ATTENUATION ±3.
      const hasRange = Number.isFinite(y.MIN_ATTENUATION) && Number.isFinite(y.MAX_ATTENUATION)
      const single = asNumber(y.ATTENUATION, 75)
      const min = hasRange ? (y.MIN_ATTENUATION as number) : Math.max(0, single - 3)
      const max = hasRange ? (y.MAX_ATTENUATION as number) : Math.min(100, single + 3)
      const use: YeastUse = {
        ingredientId: newId(),
        snapshot: {
          name: asString(y.NAME),
          attenuation_min_pct: Math.max(0, Math.min(100, min)),
          attenuation_max_pct: Math.max(0, Math.min(100, max)),
          form: mapYeastForm(y.FORM),
        },
        amount: asNumber(y.AMOUNT, 0) * 1000,
      }
      const pitch = Number.isFinite(y.PITCH_TEMP) ? y.PITCH_TEMP : y.DISP_MIN_TEMP
      if (Number.isFinite(pitch)) use.pitchTemp_C = pitch
      return use
    })

    const miscs: MiscUse[] =
      typeof r.MISCS === 'object'
        ? toArray(r.MISCS?.MISC).map((m) => ({
            ingredientId: newId(),
            snapshot: { name: asString(m.NAME), type: 'other' as const },
            amount: asNumber(m.AMOUNT, 0),
            amountUnit: mapMiscUnit(m.AMOUNT_UNIT),
            use: mapMiscUse(m.USE),
            time_min: asNumber(m.TIME, 0),
          }))
        : []

    const mashSteps: MashStep[] = toArray(
      typeof r.MASH?.MASH_STEPS === 'object' ? r.MASH.MASH_STEPS.MASH_STEP : undefined,
    ).map((s) => {
      const step: MashStep = {
        name: asString(s.NAME) || 'Mash Step',
        type: mapMashType(s.TYPE),
        temperature_C: asNumber(s.STEP_TEMP, 0),
        time_min: asNumber(s.STEP_TIME, 0),
      }
      if (Number.isFinite(s.RAMP_TIME)) step.rampTime_min = Math.max(0, s.RAMP_TIME as number)
      if (Number.isFinite(s.INFUSE_AMOUNT))
        step.waterAmount_L = Math.max(0, s.INFUSE_AMOUNT as number)
      return step
    })

    const recipe: Recipe = {
      id: newId(),
      name: asString(r.NAME) || 'Untitled Recipe',
      type: mapRecipeType(r.TYPE),
      batchSize_L: asNumber(r.BATCH_SIZE, 0),
      boilTime_min: asNumber(r.BOIL_TIME, 0),
      equipmentProfileId: newId(),
      fermentables,
      hops,
      yeasts,
      miscs,
      mashSteps,
      notes_md: r.NOTES ?? '',
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    }

    const styleId = asString(r.STYLE_ID) || asString(r.STYLE?.NAME)
    if (styleId) recipe.styleId = styleId

    const targets = buildTargets(r)
    if (targets) recipe.targets = targets

    return recipe
  })
}
