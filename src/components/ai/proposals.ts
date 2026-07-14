/**
 * Pull proposed actions out of an assistant turn's `toolTrace` (Companion v2).
 *
 * A v2 "propose" tool (see `@/lib/ai/tools/write-tools`) never writes — its result
 * is a tagged {@link Proposal} `{ kind:'proposal', action }`. Those ride in the
 * SAME `toolTrace` the read tools use. This helper walks the trace and returns one
 * `{ toolCallId, action }` per SUCCESSFUL proposal, in call order, so the drawer can
 * render an Approve/Discard card under the message that proposed it.
 *
 * Only `ok` entries whose result matches the proposal shape are returned; a FAILED
 * propose call (e.g. "recipe not found") is deliberately left in the trace so it
 * still surfaces as a normal tool-call chip — nothing is hidden.
 */

import type { ActionDescriptor, Proposal } from '@/lib/ai/actions/types'
import type { ToolTraceEntry } from '@/lib/ai/agent'

/** One proposal extracted from a turn, keyed by the tool call that produced it. */
export interface TurnProposal {
  toolCallId: string
  action: ActionDescriptor
}

/** Structural guard: is this tool result a `{ kind:'proposal', action }` payload? */
export function isProposalResult(result: unknown): result is Proposal {
  if (typeof result !== 'object' || result === null) return false
  const r = result as { kind?: unknown; action?: unknown }
  return r.kind === 'proposal' && typeof r.action === 'object' && r.action !== null
}

/**
 * Extract every proposed action from a run's `toolTrace`, in order. Returns `[]`
 * for an absent trace or a trace with no proposals (the common read-only turn).
 */
export function extractProposals(trace: ToolTraceEntry[] | undefined): TurnProposal[] {
  if (!trace) return []
  const out: TurnProposal[] = []
  for (const entry of trace) {
    if (entry.ok && isProposalResult(entry.result)) {
      out.push({ toolCallId: entry.toolCallId, action: entry.result.action })
    }
  }
  return out
}
