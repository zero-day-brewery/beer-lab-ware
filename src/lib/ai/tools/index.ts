/**
 * Read-only AI tool registry (Stage 1: the engine).
 *
 * Every tool is a thin, declarative wrapper over a function that ALREADY exists
 * in the app — a typed repo read or a pure calc/aggregator — returning a LEAN
 * summary (never a full DB blob). Inputs are Zod-validated in `run()`; the Zod
 * schema also produces the JSON schema the provider advertises (`z.toJSONSchema`,
 * Zod 4 — no new dependency).
 *
 * NOTHING here mutates data. Writes are a later stage behind a confirm gate.
 *
 * Wrapped functions (tool → real fn):
 *   list_recipes        → recipeRepo.list
 *   get_recipe          → recipeRepo.get + calculateRecipe (+ equipmentRepo)
 *   list_inventory      → inventoryRepo.list
 *   inventory_report    → buildInventoryReport + buildInventoryStats (gearRepo + inventoryRepo)
 *   list_batches        → batchRepo.list
 *   get_batch           → batchRepo.get + readingsRepo.listByBatch + diffRecipes
 *   list_water_profiles → waterRepo.list (+ so4ClRatio/so4ClBand)
 *   water_additions     → waterRepo.get + computeAdditions (TARGET_PROFILES)
 *   calc_recipe         → calculateRecipe (pure what-if, nothing saved)
 *   batch_stats         → buildBatchStats
 *   list_equipment      → equipmentRepo.list
 */

import { z } from 'zod'
import type { AiTool, JsonSchema } from '@/lib/ai/types'
import { buildBatchStats } from '@/lib/brewing/batch/batch-stats'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { buildInventoryStats } from '@/lib/brewing/inventory/freshness'
import { diffRecipes } from '@/lib/brewing/recipe/diff'
import { buildInventoryReport } from '@/lib/brewing/report/inventory-report'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Water } from '@/lib/brewing/types/ingredient'
import { InventoryKindSchema, isLowStock } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { RecipeSchema } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'
import { computeAdditions } from '@/lib/brewing/water/additions'
import type { IonProfile } from '@/lib/brewing/water/ions'
import { so4ClBand, so4ClRatio, TARGET_PROFILES } from '@/lib/brewing/water/target'
import { defaultToolDeps, type ToolDeps } from './deps'
import { buildWriteTools } from './write-tools'

// ── rounding helpers (keep results lean + stable) ──────────────────────────
const r = (n: number, dp: number): number => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}
const r1 = (n: number) => r(n, 1)
const r2 = (n: number) => r(n, 2)
const r3 = (n: number) => r(n, 3)

/**
 * Build one tool: name + description + Zod input schema + handler. The Zod schema
 * becomes the advertised JSON schema; `run` re-parses raw args before the handler
 * ever runs (throws `ZodError` on bad input — the agent surfaces it as a tool error).
 * Nullish args are treated as `{}` so zero-arg tools are ergonomic to call.
 */
function makeTool<S extends z.ZodType>(
  name: string,
  description: string,
  input: S,
  handler: (args: z.infer<S>) => Promise<unknown>,
): AiTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(input) as JsonSchema,
    // `async` so a synchronous Zod `parse` throw becomes a REJECTED promise
    // (the AiTool.run contract) — the agent loop then catches it as a tool error.
    run: async (raw: unknown) => handler(input.parse(raw ?? {}) as z.infer<S>),
  }
}

const WaterStyleKeySchema = z.enum([
  'light-hoppy',
  'neipa',
  'balanced',
  'amber-malty',
  'brown-malty',
  'dark-stout',
  'pale-lager',
])

const EmptyInput = z.object({})
const IdInput = z.object({ id: z.string().uuid() })

/** Source water row → the 6-ion profile the water calc speaks. */
function toIonProfile(w: Water | IonProfile): IonProfile {
  return {
    Ca_ppm: w.Ca_ppm,
    Mg_ppm: w.Mg_ppm,
    Na_ppm: w.Na_ppm,
    SO4_ppm: w.SO4_ppm,
    Cl_ppm: w.Cl_ppm,
    HCO3_ppm: w.HCO3_ppm,
  }
}

/** Resolve the equipment a recipe should compute against: its own, else the default. */
async function resolveEquipment(deps: ToolDeps, recipe: Recipe): Promise<EquipmentProfile | null> {
  const own = await deps.equipment.get(recipe.equipmentProfileId)
  return own ?? (await deps.equipment.getDefault())
}

/** Lean view of a full calculation result (only the numbers a brewer/model needs). */
function leanComputed(c: CalculationResult) {
  return {
    OG: r3(c.OG),
    FG: r3(c.FG),
    ABV: r1(c.ABV),
    IBU: r1(c.IBU),
    SRM: r1(c.SRM),
    strikeTemp_C: r1(c.strikeTemp_C),
    volumes: {
      mashWater_L: r2(c.volumes.mashWater_L),
      spargeWater_L: r2(c.volumes.spargeWater_L),
      preBoilVolume_L: r2(c.volumes.preBoilVolume_L),
      postBoilVolume_L: r2(c.volumes.postBoilVolume_L),
      intoFermenter_L: r2(c.volumes.intoFermenter_L),
    },
    formulasUsed: c.formulasUsed,
  }
}

/**
 * Build the read-only tool array against injected deps. Repos/clock are injectable
 * so tests can drive tools with fakes; `getTools()` uses the real Dexie singletons.
 */
export function buildTools(deps: ToolDeps = defaultToolDeps): AiTool[] {
  return [
    makeTool(
      'list_recipes',
      'List all saved recipes as lean summaries (name, style, size, ingredient counts). Read-only.',
      EmptyInput,
      async () => {
        const recipes = await deps.recipes.list()
        return recipes.map((rec) => ({
          id: rec.id,
          name: rec.name,
          type: rec.type,
          styleId: rec.styleId,
          batchSize_L: rec.batchSize_L,
          boilTime_min: rec.boilTime_min,
          tags: rec.tags,
          targets: rec.targets,
          fermentableCount: rec.fermentables.length,
          hopCount: rec.hops.length,
          yeastCount: rec.yeasts.length,
          updatedAt: rec.updatedAt,
        }))
      },
    ),

    makeTool(
      'get_recipe',
      'Get one recipe by id with its COMPUTED vitals (OG/FG/ABV/IBU/SRM) from the calc engine. Read-only.',
      IdInput,
      async ({ id }) => {
        const recipe = await deps.recipes.get(id)
        if (!recipe) return null
        const equipment = await resolveEquipment(deps, recipe)
        const computed = equipment
          ? leanComputed(calculateRecipe(recipe, equipment, deps.now().toISOString()))
          : null
        return {
          id: recipe.id,
          name: recipe.name,
          type: recipe.type,
          styleId: recipe.styleId,
          batchSize_L: recipe.batchSize_L,
          boilTime_min: recipe.boilTime_min,
          tags: recipe.tags,
          targets: recipe.targets,
          computed,
          computedWith: equipment ? equipment.name : null,
          fermentables: recipe.fermentables.map((f) => ({
            name: f.snapshot.name,
            amount_kg: f.amount_kg,
            usage: f.usage,
          })),
          hops: recipe.hops.map((h) => ({
            name: h.snapshot.name,
            amount_g: h.amount_g,
            time_min: h.time_min,
            use: h.use,
          })),
          yeasts: recipe.yeasts.map((y) => ({ name: y.snapshot.name, amount: y.amount })),
          miscs: recipe.miscs.map((m) => ({
            name: m.snapshot.name,
            amount: m.amount,
            amountUnit: m.amountUnit,
          })),
        }
      },
    ),

    makeTool(
      'list_inventory',
      'List pantry inventory items (optionally filtered by kind) with amount, unit, and low-stock flag. Read-only.',
      z.object({ kind: InventoryKindSchema.optional() }),
      async ({ kind }) => {
        const items = await deps.inventory.list()
        const filtered = kind ? items.filter((i) => i.ingredientKind === kind) : items
        return filtered.map((i) => ({
          id: i.id,
          name: i.name,
          ingredientKind: i.ingredientKind,
          amount: i.amount,
          amountUnit: i.amountUnit,
          status: i.status,
          lowStock: isLowStock(i),
          pricePerUnit_USD: i.pricePerUnit_USD,
        }))
      },
    ),

    makeTool(
      'inventory_report',
      'Summarize the pantry: item groups, total value, low-stock/expiring counts, and a par-driven shopping list. Read-only.',
      EmptyInput,
      async () => {
        const [gear, inventory] = await Promise.all([deps.gear.list(), deps.inventory.list()])
        const now = deps.now()
        const report = buildInventoryReport({ gear, inventory, generatedAt: now })
        const stats = buildInventoryStats(inventory, now)
        return {
          generatedAt: report.generatedAtISO,
          totalItems: report.ingredients.totalCount,
          lowStockCount: report.ingredients.lowStockCount,
          pastBestByCount: report.ingredients.pastBestByCount,
          expiringSoonCount: stats.expiringSoonCount,
          totalValue_USD: r2(stats.totalValue_USD),
          ingredientGroups: report.ingredients.groups.map((g) => ({
            label: g.label,
            count: g.count,
          })),
          gearGroups: report.gear.groups.map((g) => ({ label: g.label, count: g.count })),
          shopping: stats.shopping.map((line) => ({
            name: line.item.name,
            unit: line.item.amountUnit,
            deficit: r2(line.deficit),
            estCost_USD: r2(line.estCost),
          })),
        }
      },
    ),

    makeTool(
      'list_batches',
      'List brew batches (batch no, name, status, style, measured ABV/rating, dates). Read-only.',
      EmptyInput,
      async () => {
        const batches = await deps.batches.list()
        return batches.map((b) => ({
          id: b.id,
          batchNo: b.batchNo,
          name: b.name,
          status: b.status,
          recipeName: b.recipeSnapshot?.name,
          measuredABV: b.results.measuredABV,
          rating: b.tasting?.rating,
          brewedAt: b.brewedAt,
          startedAt: b.startedAt,
        }))
      },
    ),

    makeTool(
      'get_batch',
      'Get one batch by id with results, tasting, fermentation readings, and any drift from its source recipe. Read-only.',
      IdInput,
      async ({ id }) => {
        const batch = await deps.batches.get(id)
        if (!batch) return null
        const readings = await deps.readings.listByBatch(id)

        // Brew "drift": how the live recipe has changed since this batch's snapshot.
        let recipeDrift: ReturnType<typeof diffRecipes> | null = null
        if (batch.recipeSnapshot && batch.recipeId) {
          const current = await deps.recipes.get(batch.recipeId)
          if (current) recipeDrift = diffRecipes(batch.recipeSnapshot, current)
        }

        return {
          id: batch.id,
          batchNo: batch.batchNo,
          name: batch.name,
          status: batch.status,
          recipeName: batch.recipeSnapshot?.name,
          styleId: batch.recipeSnapshot?.styleId,
          results: batch.results,
          tasting: batch.tasting
            ? { rating: batch.tasting.rating, overall_md: batch.tasting.overall_md }
            : undefined,
          computedTargets: batch.computedTargets ? leanComputed(batch.computedTargets) : null,
          readingCount: readings.length,
          readings: readings.map((rd) => ({
            at: rd.at,
            gravity: rd.gravity,
            tempC: rd.tempC,
            ph: rd.ph,
          })),
          recipeDrift: recipeDrift
            ? {
                changed: !recipeDrift.isEmpty,
                fields: recipeDrift.fields,
                ingredients: recipeDrift.ingredients,
              }
            : null,
          brewedAt: batch.brewedAt,
          startedAt: batch.startedAt,
        }
      },
    ),

    makeTool(
      'list_water_profiles',
      'List saved source-water profiles with their ion ppm and SO4:Cl balance band. Read-only.',
      EmptyInput,
      async () => {
        const profiles = await deps.water.list()
        return profiles.map((w) => {
          const ratio = so4ClRatio(w)
          return {
            id: w.id,
            name: w.name,
            Ca_ppm: w.Ca_ppm,
            Mg_ppm: w.Mg_ppm,
            Na_ppm: w.Na_ppm,
            SO4_ppm: w.SO4_ppm,
            Cl_ppm: w.Cl_ppm,
            HCO3_ppm: w.HCO3_ppm,
            so4ClRatio: Number.isFinite(ratio) ? r2(ratio) : null,
            balance: so4ClBand(ratio).label,
          }
        })
      },
    ),

    makeTool(
      'water_additions',
      'Compute brewing-salt additions (grams) to move a source water profile toward a target water style at a given volume. Read-only.',
      z.object({
        profileId: z.string().uuid(),
        targetStyle: WaterStyleKeySchema,
        volume_L: z.number().positive(),
      }),
      async ({ profileId, targetStyle, volume_L }) => {
        const source = await deps.water.get(profileId)
        if (!source) return null
        const result = computeAdditions(
          toIonProfile(source),
          TARGET_PROFILES[targetStyle],
          volume_L,
        )
        return {
          sourceName: source.name,
          targetStyle,
          volume_L,
          grams: {
            gypsum: r2(result.grams.gypsum),
            cacl2: r2(result.grams.cacl2),
            epsom: r2(result.grams.epsom),
            nacl: r2(result.grams.nacl),
            nahco3: r2(result.grams.nahco3),
          },
          resultIons: {
            Ca_ppm: r1(result.result.Ca_ppm),
            Mg_ppm: r1(result.result.Mg_ppm),
            Na_ppm: r1(result.result.Na_ppm),
            SO4_ppm: r1(result.result.SO4_ppm),
            Cl_ppm: r1(result.result.Cl_ppm),
            HCO3_ppm: r1(result.result.HCO3_ppm),
          },
          so4Cl: Number.isFinite(result.so4cl) ? r2(result.so4cl) : null,
          balance: so4ClBand(result.so4cl).label,
          warnings: result.warnings,
        }
      },
    ),

    makeTool(
      'calc_recipe',
      'Run the calc engine on a recipe draft WITHOUT saving it (what-if design): returns OG/FG/ABV/IBU/SRM, strike temp, and volumes. Read-only.',
      z.object({ recipe: RecipeSchema, equipmentProfileId: z.string().uuid().optional() }),
      async ({ recipe, equipmentProfileId }) => {
        const equipment = equipmentProfileId
          ? await deps.equipment.get(equipmentProfileId)
          : await resolveEquipment(deps, recipe)
        if (!equipment) {
          return { error: 'No equipment profile available to compute against.' }
        }
        return {
          recipeName: recipe.name,
          computedWith: equipment.name,
          computed: leanComputed(calculateRecipe(recipe, equipment, deps.now().toISOString())),
        }
      },
    ),

    makeTool(
      'batch_stats',
      'Roll up brew-history stats: totals by status, brewed this month/year, avg measured ABV, most-brewed style/type, avg rating. Read-only.',
      EmptyInput,
      async () => {
        const batches = await deps.batches.list()
        return buildBatchStats(batches, deps.now())
      },
    ),

    makeTool(
      'list_equipment',
      'List equipment profiles (volumes, efficiencies, formula choices, which is default). Read-only.',
      EmptyInput,
      async () => {
        const profiles = await deps.equipment.list()
        return profiles.map((e) => ({
          id: e.id,
          name: e.name,
          isDefault: e.isDefault,
          kettleVolume_L: e.kettleVolume_L,
          fermenterVolume_L: e.fermenterVolume_L,
          mashEfficiency_pct: e.mashEfficiency_pct,
          brewhouseEfficiency_pct: e.brewhouseEfficiency_pct,
          ibuFormula: e.ibuFormula,
          srmFormula: e.srmFormula,
          abvFormula: e.abvFormula,
        }))
      },
    ),
  ]
}

/** The read-only tool set wired to the live Dexie repos (production entry point). */
export function getTools(): AiTool[] {
  return buildTools(defaultToolDeps)
}

/**
 * The FULL tool set = the v1 read-only tools PLUS the v2 "propose" write tools
 * (`buildWriteTools`). The propose tools still take READ deps only — they never
 * write; the sole write path is `applyAction` behind human approval. Kept
 * SEPARATE from `buildTools` so the pure read-only set Stage 1 ships stays
 * exactly as-is (callers that must not surface write actions keep using
 * `buildTools`/`getTools`).
 */
export function buildAllTools(deps: ToolDeps = defaultToolDeps): AiTool[] {
  return [...buildTools(deps), ...buildWriteTools(deps)]
}
