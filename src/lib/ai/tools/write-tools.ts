/**
 * Companion v2 Stage A — the "propose" tools (confirm-gated writes).
 *
 * SAFETY INVARIANT: these tools MUST NOT WRITE. Each is built over the SAME
 * read-only {@link ToolDeps} the v1 registry uses — they look things up, run the
 * pure brewing math to build a truthful preview, and hand back a
 * {@link Proposal}. They never call `.save`, `.create`, `applyStockChange`, or
 * any other mutation. The single write path is `applyAction` (see
 * `../actions/apply.ts`), which the Stage B UI calls ONLY after the human
 * approves. Tests assert the DB is byte-for-byte unchanged after each propose.
 *
 * Propose tool → what it builds:
 *   propose_scale_recipe    → a NEW scaled recipe payload + before→after (size/OG) preview
 *   propose_create_recipe   → a NEW recipe payload from a full draft (fresh id/timestamps)
 *   propose_log_reading     → a fermentation reading payload + "add SG … to <batch>" preview
 *   propose_adjust_inventory→ a signed ledger delta payload + "<item>: old → new unit" preview
 */

import { z } from 'zod'
import type { Proposal, ScaleRecipePreview } from '@/lib/ai/actions/types'
import { AdjustInventoryPayloadSchema } from '@/lib/ai/actions/types'
import type { AiTool, JsonSchema } from '@/lib/ai/types'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { scaleRecipe, scaleToOG, withFreshTargets } from '@/lib/brewing/recipe/scale'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import { type Reading, ReadingSchema } from '@/lib/brewing/types/reading'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'
import { StockReasonSchema } from '@/lib/brewing/types/stock-transaction'
import { newId } from '@/lib/utils/id'
import { defaultToolDeps, type ToolDeps } from './deps'

// ── local helpers (parallel to tools/index.ts; kept separate so the v1 ────────
// read-only registry stays untouched) ────────────────────────────────────────

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Build one propose tool: name + description + Zod input schema + handler. The
 * Zod schema becomes the advertised JSON schema; `run` re-parses raw args before
 * the handler runs. The handler returns a {@link Proposal} — never a write.
 */
function makeProposalTool<S extends z.ZodType>(
  name: string,
  description: string,
  input: S,
  handler: (args: z.infer<S>) => Promise<Proposal>,
): AiTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(input) as JsonSchema,
    run: async (raw: unknown) => handler(input.parse(raw ?? {}) as z.infer<S>),
  }
}

/** Resolve the equipment a recipe should compute against: its own, else the default. */
async function resolveEquipment(deps: ToolDeps, recipe: Recipe): Promise<EquipmentProfile | null> {
  const own = await deps.equipment.get(recipe.equipmentProfileId)
  return own ?? (await deps.equipment.getDefault())
}

// ── input schemas ─────────────────────────────────────────────────────────

const ScaleInput = z
  .object({
    recipeId: z.string().uuid(),
    targetBatchSize_L: z.number().positive().optional(),
    targetOG: z.number().positive().optional(),
  })
  .refine((v) => (v.targetBatchSize_L != null) !== (v.targetOG != null), {
    message: 'Provide exactly one of targetBatchSize_L or targetOG',
  })

const LogReadingInput = z.object({
  batchId: z.string().min(1),
  gravity: z.number(),
  tempC: z.number().optional(),
  atISO: z.string().datetime().optional(),
})

const AdjustInventoryInput = z
  .object({
    inventoryItemId: z.string().uuid(),
    delta: z.number().optional(),
    newAmount: z.number().nonnegative().optional(),
    reason: StockReasonSchema.optional(),
    note: z.string().optional(),
  })
  .refine((v) => (v.delta != null) !== (v.newAmount != null), {
    message: 'Provide exactly one of delta or newAmount',
  })

const CreateRecipeInput = z.object({ draft: RecipeSchema })

/**
 * Build the propose-tool array against injected READ deps. The write path
 * (`applyAction`) is deliberately NOT reachable from here. Repos/clock are
 * injectable so tests can drive proposals with fakes and assert no write.
 */
export function buildWriteTools(deps: ToolDeps = defaultToolDeps): AiTool[] {
  return [
    makeProposalTool(
      'propose_scale_recipe',
      'Propose scaling a saved recipe to a new batch size OR a target OG. Builds a NEW recipe (does NOT save) plus a before→after preview. Requires human approval before anything is written.',
      ScaleInput,
      async ({ recipeId, targetBatchSize_L, targetOG }): Promise<Proposal> => {
        const recipe = await deps.recipes.get(recipeId)
        if (!recipe) throw new Error(`propose_scale_recipe: recipe not found (${recipeId})`)
        const equipment = await resolveEquipment(deps, recipe)
        if (!equipment) {
          throw new Error('propose_scale_recipe: no equipment profile available to compute against')
        }
        const now = deps.now().toISOString()

        // Scale via the existing pure helpers (fresh id, original never mutated).
        const scaled =
          targetBatchSize_L != null
            ? scaleRecipe(recipe, targetBatchSize_L)
            : scaleToOG(recipe, equipment, targetOG as number)
        // Canonical "(scaled)" name off the ORIGINAL name (helpers append their own suffix).
        const named: Recipe = { ...scaled, name: `${recipe.name} (scaled)` }
        // Refresh printed targets so they match the scaled composition, then validate.
        const withTargets = withFreshTargets(named, equipment, now)
        const payload = RecipeSchema.parse(withTargets)

        const beforeCalc = calculateRecipe(recipe, equipment, now)
        const afterCalc = calculateRecipe(payload, equipment, now)
        const preview: ScaleRecipePreview = {
          recipeName: recipe.name,
          before: { batchSize_L: recipe.batchSize_L, OG: r3(beforeCalc.OG) },
          after: { batchSize_L: payload.batchSize_L, OG: r3(afterCalc.OG) },
        }
        return {
          kind: 'proposal',
          action: {
            type: 'scale_recipe',
            title: `Scale "${recipe.name}" → ${payload.batchSize_L} L`,
            preview,
            payload,
          },
        }
      },
    ),

    makeProposalTool(
      'propose_create_recipe',
      'Propose saving a brand-new recipe from a full recipe draft. Assigns a fresh id + timestamps and validates the draft, but does NOT save. Requires human approval before anything is written.',
      CreateRecipeInput,
      async ({ draft }): Promise<Proposal> => {
        const now = deps.now().toISOString()
        // Fresh id/timestamps so a proposal can never clobber an existing recipe.
        const payload = RecipeSchema.parse({
          ...draft,
          id: newId(),
          createdAt: now,
          updatedAt: now,
        })
        return {
          kind: 'proposal',
          action: {
            type: 'create_recipe',
            title: `Create recipe "${payload.name}"`,
            preview: `Create "${payload.name}" — ${payload.type}, ${payload.batchSize_L} L, ${payload.fermentables.length} fermentable(s) / ${payload.hops.length} hop(s)`,
            payload,
          },
        }
      },
    ),

    makeProposalTool(
      'propose_log_reading',
      'Propose logging a fermentation reading (gravity, optional temp) for a batch. Validates the batch exists and builds the reading row, but does NOT save. Requires human approval before anything is written.',
      LogReadingInput,
      async ({ batchId, gravity, tempC, atISO }): Promise<Proposal> => {
        const batch = await deps.batches.get(batchId)
        if (!batch) throw new Error(`propose_log_reading: batch not found (${batchId})`)
        const at = atISO ?? deps.now().toISOString()
        const reading: Reading = {
          id: newId(),
          batchId,
          at,
          gravity,
          ...(tempC != null ? { tempC } : {}),
          schemaVersion: 1,
        }
        const payload = ReadingSchema.parse(reading)
        const tempPart = tempC != null ? ` @ ${tempC}°C` : ''
        return {
          kind: 'proposal',
          action: {
            type: 'log_reading',
            title: `Log reading for "${batch.name}"`,
            preview: `Add SG ${gravity}${tempPart} @ ${at} to "${batch.name}"`,
            payload,
          },
        }
      },
    ),

    makeProposalTool(
      'propose_adjust_inventory',
      "Propose adjusting an inventory item's on-hand stock by a delta or to a target amount. Computes the signed ledger delta + a before→after preview, but does NOT write. Requires human approval before anything is committed to the stock ledger.",
      AdjustInventoryInput,
      async ({ inventoryItemId, delta, newAmount, reason, note }): Promise<Proposal> => {
        // Read contract only exposes list(); find the item (no write, no repo.get needed).
        const items = await deps.inventory.list()
        const item = items.find((i) => i.id === inventoryItemId)
        if (!item) throw new Error(`propose_adjust_inventory: item not found (${inventoryItemId})`)

        const old = item.amount
        // Effective signed delta: explicit delta, else (target − current).
        const effectiveDelta = delta != null ? delta : (newAmount as number) - old
        // Preview the clamped result the way the atomic repo will apply it (never < 0).
        const projected = Math.max(0, old + effectiveDelta)
        const payload = AdjustInventoryPayloadSchema.parse({
          inventoryItemId,
          delta: effectiveDelta,
          reason: reason ?? 'manual-adjust',
          ...(note != null ? { note } : {}),
        })
        return {
          kind: 'proposal',
          action: {
            type: 'adjust_inventory',
            title: `Adjust "${item.name}" stock`,
            preview: `${item.name}: ${old} → ${projected} ${item.amountUnit}`,
            payload,
          },
        }
      },
    ),
  ]
}
