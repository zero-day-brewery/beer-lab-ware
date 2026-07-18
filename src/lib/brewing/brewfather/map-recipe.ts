/**
 * Pure mapper: Brewfather recipe JSON → app `Recipe`. No I/O, no clock — the
 * caller injects `now`. Defensive per the import contract: unknown fields are
 * ignored, known-missing fields are defaulted WITH a warning, and anything
 * whose semantics are ambiguous is skipped with a warning rather than guessed.
 * A recipe missing its core identity (positive batch size) is skipped whole.
 */
import type { Recipe, RecipeType, Targets } from '@/lib/brewing/types/recipe'
import { RecipeSchema } from '@/lib/brewing/types/recipe'
import type {
  FermentableUse,
  HopUse,
  MashStep,
  MiscUse,
  YeastUse,
} from '@/lib/brewing/types/recipe-parts'
import { brewfatherId } from './ids'
import {
  BfFermentableSchema,
  BfHopSchema,
  BfMashStepSchema,
  BfMiscSchema,
  type BfRecipe,
  BfRecipeSchema,
  BfYeastSchema,
  bfTimestampToIso,
} from './schemas'

export interface MappedRecipe {
  recipe: Recipe | null
  warnings: string[]
}

/** EBC → SRM (Brewfather recipe color is EBC-native). */
const EBC_TO_SRM = 1 / 1.97

const DEFAULT_PPG = 35 // ≈ 76% yield — used only when the file carries no potential at all

function mapRecipeType(raw: string | undefined, warn: (msg: string) => void): RecipeType {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'all grain') return 'all-grain'
  if (lower === 'extract') return 'extract'
  if (lower === 'partial mash') return 'partial-mash'
  if (lower !== '') warn(`unknown recipe type "${raw}" — defaulted to all-grain`)
  return 'all-grain'
}

function mapFermentableType(raw: string | undefined): FermentableUse['snapshot']['type'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'grain' || lower === '') return 'base'
  if (lower === 'sugar' || lower === 'honey') return 'sugar'
  if (lower === 'extract' || lower === 'dry extract' || lower === 'liquid extract') return 'extract'
  if (lower === 'adjunct' || lower === 'fruit' || lower === 'juice') return 'adjunct'
  return 'specialty'
}

function potentialToPpg(f: { potential?: number; potentialPercentage?: number }): number | null {
  if (f.potential !== undefined && f.potential > 1) return Math.round((f.potential - 1) * 1000)
  if (f.potentialPercentage !== undefined && f.potentialPercentage > 0)
    return Math.round(f.potentialPercentage * 0.46)
  return null
}

function mapHopUse(raw: string | undefined): HopUse['use'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'dry hop') return 'dry-hop'
  if (lower === 'aroma' || lower === 'whirlpool' || lower === 'hopstand') return 'whirlpool'
  if (lower === 'first wort') return 'first-wort'
  if (lower === 'mash') return 'mash'
  return 'boil'
}

function mapHopForm(raw: string | undefined): HopUse['snapshot']['form'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'leaf' || lower === 'whole') return 'leaf'
  if (lower === 'plug') return 'plug'
  if (lower.includes('extract')) return 'extract'
  if (lower.includes('cryo')) return 'cryo'
  return 'pellet'
}

function mapYeastForm(raw: string | undefined): YeastUse['snapshot']['form'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'liquid') return 'liquid'
  if (lower === 'slant') return 'slant'
  if (lower === 'culture') return 'culture'
  return 'dry'
}

function mapMiscType(raw: string | undefined): MiscUse['snapshot']['type'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'water agent') return 'water-agent'
  if (lower === 'fining') return 'fining'
  if (lower === 'spice' || lower === 'herb') return 'spice'
  if (lower === 'flavor' || lower === 'flavour') return 'flavor'
  return 'other'
}

function mapMiscUse(raw: string | undefined, warn: (msg: string) => void): MiscUse['use'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'mash') return 'mash'
  if (lower === 'primary') return 'primary'
  if (lower === 'secondary') return 'secondary'
  if (lower === 'bottling') return 'bottling'
  if (lower === 'sparge') {
    warn('misc use "Sparge" has no app equivalent — mapped to mash')
    return 'mash'
  }
  return 'boil'
}

function mapMashStepType(raw: string | undefined): MashStep['type'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'temperature') return 'temperature'
  if (lower === 'decoction') return 'decoction'
  return 'infusion'
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function buildTargets(bf: BfRecipe): Targets | undefined {
  const t: Targets = {}
  if (bf.og !== undefined) t.OG = bf.og
  if (bf.fg !== undefined) t.FG = bf.fg
  if (bf.abv !== undefined) t.ABV = bf.abv
  if (bf.ibu !== undefined) t.IBU = bf.ibu
  if (bf.color !== undefined && bf.color >= 0) t.SRM = Math.round(bf.color * EBC_TO_SRM * 10) / 10
  return Object.keys(t).length > 0 ? t : undefined
}

export function mapBrewfatherRecipe(raw: unknown, opts: { now: string }): MappedRecipe {
  const warnings: string[] = []
  const parsed = BfRecipeSchema.safeParse(raw)
  if (!parsed.success) {
    return { recipe: null, warnings: ['Skipped entity: not a recognizable Brewfather recipe'] }
  }
  const bf = parsed.data

  const name = bf.name?.trim() || 'Untitled Recipe'
  const label = `Recipe "${name}"`
  const warn = (msg: string) => warnings.push(`${label}: ${msg}`)
  if (!bf.name?.trim()) warn('name missing — defaulted to "Untitled Recipe"')

  // Core identity: a recipe without a positive batch size can't drive any calc.
  if (bf.batchSize === undefined || bf.batchSize <= 0) {
    warn('skipped — batch size missing or not positive')
    return { recipe: null, warnings }
  }

  // Stable id: Brewfather `_id` when present, name-derived fallback otherwise.
  const key = bf._id ?? `name:${name}`
  if (!bf._id) warn('no Brewfather _id — id derived from name (re-imports match by name)')
  const id = brewfatherId('recipe', key)

  let boilTime = bf.boilTime
  if (boilTime === undefined || boilTime < 0) {
    warn('boil time missing — defaulted to 0 min')
    boilTime = 0
  }

  const fermentables: FermentableUse[] = []
  for (const [i, rawF] of (bf.fermentables ?? []).entries()) {
    const f = BfFermentableSchema.safeParse(rawF)
    if (!f.success) {
      warn(`fermentable #${i + 1} skipped — unrecognizable entry`)
      continue
    }
    const fName = f.data.name?.trim() || `Fermentable ${i + 1}`
    let ppg = potentialToPpg(f.data)
    if (ppg === null || ppg <= 0) {
      warn(`fermentable "${fName}" has no potential/yield — ppg defaulted to ${DEFAULT_PPG}`)
      ppg = DEFAULT_PPG
    }
    // Brewfather fermentable color is Lovibond-native (recipe color is EBC).
    const color = f.data.lovibond ?? f.data.color
    fermentables.push({
      ingredientId: brewfatherId('ingredient', `${key}:fermentable:${i}:${fName}`),
      snapshot: {
        name: fName,
        type: mapFermentableType(f.data.type),
        ppg,
        color_L: color !== undefined && color >= 0 ? color : 0,
      },
      amount_kg: Math.max(0, f.data.amount ?? 0),
      usage: 'mash',
      afterBoil: false,
    })
  }

  const hops: HopUse[] = []
  for (const [i, rawH] of (bf.hops ?? []).entries()) {
    const h = BfHopSchema.safeParse(rawH)
    if (!h.success) {
      warn(`hop #${i + 1} skipped — unrecognizable entry`)
      continue
    }
    const hName = h.data.name?.trim() || `Hop ${i + 1}`
    const use = mapHopUse(h.data.use)
    // Brewfather stores dry-hop duration in units we can't disambiguate (days
    // vs minutes across export versions). Ambiguous → not imported (0), warned.
    let time = Math.max(0, h.data.time ?? 0)
    if (use === 'dry-hop' && h.data.time !== undefined) {
      warn(
        `dry hop "${hName}": Brewfather dry-hop duration units are ambiguous — time not imported`,
      )
      time = 0
    }
    hops.push({
      ingredientId: brewfatherId('ingredient', `${key}:hop:${i}:${hName}`),
      snapshot: {
        name: hName,
        alphaAcid_pct: clamp(h.data.alpha ?? 0, 0, 30),
        form: mapHopForm(h.data.type),
      },
      amount_g: Math.max(0, h.data.amount ?? 0),
      time_min: time,
      use,
    })
  }

  const yeasts: YeastUse[] = []
  for (const [i, rawY] of (bf.yeasts ?? []).entries()) {
    const y = BfYeastSchema.safeParse(rawY)
    if (!y.success) {
      warn(`yeast #${i + 1} skipped — unrecognizable entry`)
      continue
    }
    const yName = y.data.name?.trim() || `Yeast ${i + 1}`
    const hasRange = y.data.minAttenuation !== undefined && y.data.maxAttenuation !== undefined
    const single = y.data.attenuation ?? 75
    const min = hasRange ? (y.data.minAttenuation as number) : single - 3
    const max = hasRange ? (y.data.maxAttenuation as number) : single + 3
    // Yeast amount: g/ml/l convert cleanly; "pkg" counts are kept as-is with a warning.
    const unit = (y.data.unit ?? 'pkg').toLowerCase()
    let amount = Math.max(0, y.data.amount ?? 0)
    if (unit === 'l') amount *= 1000
    else if (unit !== 'g' && unit !== 'ml' && amount > 0) {
      warn(
        `yeast "${yName}": amount is in "${y.data.unit ?? 'pkg'}" (packages) — stored as a count`,
      )
    }
    yeasts.push({
      ingredientId: brewfatherId('ingredient', `${key}:yeast:${i}:${yName}`),
      snapshot: {
        name: yName,
        attenuation_min_pct: clamp(min, 0, 100),
        attenuation_max_pct: clamp(max, 0, 100),
        form: mapYeastForm(y.data.form),
      },
      amount,
    })
  }

  const miscs: MiscUse[] = []
  for (const [i, rawM] of (bf.miscs ?? []).entries()) {
    const m = BfMiscSchema.safeParse(rawM)
    if (!m.success) {
      warn(`misc #${i + 1} skipped — unrecognizable entry`)
      continue
    }
    const mName = m.data.name?.trim() || `Misc ${i + 1}`
    const unitRaw = (m.data.unit ?? 'g').toLowerCase()
    let amount = Math.max(0, m.data.amount ?? 0)
    let amountUnit: MiscUse['amountUnit']
    if (unitRaw === 'g' || unitRaw === 'ml' || unitRaw === 'tsp' || unitRaw === 'tbsp') {
      amountUnit = unitRaw
    } else if (unitRaw === 'items' || unitRaw === 'item' || unitRaw === 'each') {
      amountUnit = 'each'
    } else if (unitRaw === 'kg') {
      amount *= 1000
      amountUnit = 'g'
    } else if (unitRaw === 'l') {
      amount *= 1000
      amountUnit = 'ml'
    } else {
      warn(`misc "${mName}" skipped — unit "${m.data.unit}" has no app equivalent`)
      continue
    }
    miscs.push({
      ingredientId: brewfatherId('ingredient', `${key}:misc:${i}:${mName}`),
      snapshot: { name: mName, type: mapMiscType(m.data.type) },
      amount,
      amountUnit,
      use: mapMiscUse(m.data.use, warn),
      time_min: Math.max(0, m.data.time ?? 0),
    })
  }

  const mashSteps: MashStep[] = []
  for (const [i, rawS] of (bf.mash?.steps ?? []).entries()) {
    const s = BfMashStepSchema.safeParse(rawS)
    if (!s.success) {
      warn(`mash step #${i + 1} skipped — unrecognizable entry`)
      continue
    }
    if (s.data.stepTemp === undefined) {
      warn(`mash step #${i + 1} skipped — no step temperature`)
      continue
    }
    const step: MashStep = {
      name: s.data.name?.trim() || 'Mash Step',
      type: mapMashStepType(s.data.type),
      temperature_C: s.data.stepTemp,
      time_min: Math.max(0, s.data.stepTime ?? 0),
    }
    if (s.data.rampTime !== undefined && s.data.rampTime >= 0) step.rampTime_min = s.data.rampTime
    mashSteps.push(step)
  }

  // Sections the app has no model for — surfaced once, not silently dropped.
  const unsupported = (['equipment', 'fermentation', 'water'] as const).filter(
    (k) => bf[k] !== undefined,
  )
  if (unsupported.length > 0) {
    warn(`unsupported sections not imported: ${unsupported.join(', ')}`)
  }

  const created = bfTimestampToIso(bf.created)
  const createdAt = created && created <= opts.now ? created : opts.now

  const recipe: Recipe = {
    id,
    name,
    type: mapRecipeType(bf.type, warn),
    batchSize_L: bf.batchSize,
    boilTime_min: boilTime,
    // Deterministic dangling FK, same convention as the BeerXML importer: the
    // user assigns a real equipment profile after import.
    equipmentProfileId: brewfatherId('equipment', key),
    fermentables,
    hops,
    yeasts,
    miscs,
    mashSteps,
    notes_md: bf.notes ?? '',
    createdAt,
    updatedAt: opts.now,
    schemaVersion: 1,
  }
  if (bf.tags && bf.tags.length > 0) recipe.tags = bf.tags
  const styleName = bf.style?.name?.trim()
  if (styleName) recipe.styleId = styleName
  const targets = buildTargets(bf)
  if (targets) recipe.targets = targets

  const valid = RecipeSchema.safeParse(recipe)
  if (!valid.success) {
    warn(
      `skipped — mapped recipe failed validation (${valid.error.issues[0]?.message ?? 'unknown'})`,
    )
    return { recipe: null, warnings }
  }
  return { recipe: valid.data, warnings }
}
