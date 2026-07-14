/**
 * Turn a run's `toolTrace` into human-readable chip labels for the drawer.
 *
 * Each read-only tool the agent called becomes one chip under the assistant turn
 * ("read your inventory", "calculated West Coast IPA") so the brewer can SEE what
 * the companion actually looked at — the transparency the design spec calls for.
 * A failed call is still shown (so nothing is hidden) but flagged, so the brewer
 * knows a lookup didn't land.
 */

import type { ToolTraceEntry } from '@/lib/ai/agent'

export interface ToolChip {
  key: string
  label: string
  ok: boolean
}

/** Pull a recipe/batch name out of a call's args or result, if present. */
function nameFrom(entry: ToolTraceEntry): string | undefined {
  const args = entry.args as { recipe?: { name?: unknown }; name?: unknown } | null | undefined
  const result = entry.result as { name?: unknown; recipeName?: unknown } | null | undefined
  const candidates = [args?.recipe?.name, result?.name, result?.recipeName]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim()
  }
  return undefined
}

/** Friendly present-tense description of a single tool call. */
function describe(entry: ToolTraceEntry): string {
  const name = nameFrom(entry)
  switch (entry.name) {
    case 'list_recipes':
      return 'read your recipes'
    case 'get_recipe':
      return name ? `read ${name}` : 'read a recipe'
    case 'list_inventory':
      return 'read your inventory'
    case 'inventory_report':
      return 'checked your pantry'
    case 'list_batches':
      return 'read your brew log'
    case 'get_batch':
      return name ? `read ${name}` : 'read a batch'
    case 'list_water_profiles':
      return 'read your water profiles'
    case 'water_additions':
      return 'calculated water salts'
    case 'calc_recipe':
      return name ? `calculated ${name}` : 'ran the calc engine'
    case 'batch_stats':
      return 'rolled up your brew stats'
    case 'list_equipment':
      return 'read your equipment'
    // Propose (v2 write) tools — a SUCCESSFUL propose renders as an action card,
    // so it's filtered out of the chip row; a FAILED one still shows here.
    case 'propose_scale_recipe':
      return name ? `proposed scaling ${name}` : 'proposed a recipe scale'
    case 'propose_create_recipe':
      return 'proposed a new recipe'
    case 'propose_log_reading':
      return 'proposed a fermentation reading'
    case 'propose_adjust_inventory':
      return 'proposed a stock adjustment'
    default:
      return entry.name.replace(/_/g, ' ')
  }
}

/** Map a whole run's trace to display chips, in call order. */
export function toolChips(trace: ToolTraceEntry[] | undefined): ToolChip[] {
  if (!trace) return []
  return trace.map((entry, i) => ({
    key: `${entry.toolCallId || entry.name}-${i}`,
    label: entry.ok ? describe(entry) : `${describe(entry)} — failed`,
    ok: entry.ok,
  }))
}
