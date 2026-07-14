import { describe, expect, it } from 'vitest'
import { extractProposals, isProposalResult } from '@/components/ai/proposals'
import type { ScaleRecipeAction } from '@/lib/ai/actions/types'
import type { ToolTraceEntry } from '@/lib/ai/agent'

const scaleAction: ScaleRecipeAction = {
  type: 'scale_recipe',
  title: 'Scale "West Coast IPA" → 40 L',
  preview: {
    recipeName: 'West Coast IPA',
    before: { batchSize_L: 20, OG: 1.062 },
    after: { batchSize_L: 40, OG: 1.062 },
  },
  // The card never touches the payload; a partial recipe is fine for this test.
  payload: { name: 'West Coast IPA (scaled)' } as ScaleRecipeAction['payload'],
}

const readEntry: ToolTraceEntry = {
  toolCallId: 'r1',
  name: 'list_inventory',
  args: {},
  ok: true,
  result: [{ name: 'Citra', amount: 2 }],
}
const proposalEntry: ToolTraceEntry = {
  toolCallId: 'p1',
  name: 'propose_scale_recipe',
  args: { recipeId: 'x', targetBatchSize_L: 40 },
  ok: true,
  result: { kind: 'proposal', action: scaleAction },
}
const failedProposeEntry: ToolTraceEntry = {
  toolCallId: 'p2',
  name: 'propose_scale_recipe',
  args: { recipeId: 'missing' },
  ok: false,
  error: 'recipe not found',
}

describe('isProposalResult', () => {
  it('accepts a {kind:"proposal", action} object only', () => {
    expect(isProposalResult({ kind: 'proposal', action: scaleAction })).toBe(true)
    expect(isProposalResult({ kind: 'other', action: {} })).toBe(false)
    expect(isProposalResult({ kind: 'proposal' })).toBe(false)
    expect(isProposalResult(null)).toBe(false)
    expect(isProposalResult('proposal')).toBe(false)
    expect(isProposalResult([{ name: 'Citra' }])).toBe(false)
  })
})

describe('extractProposals', () => {
  it('returns [] for an absent trace', () => {
    expect(extractProposals(undefined)).toEqual([])
  })

  it('returns [] when the turn only ran read tools', () => {
    expect(extractProposals([readEntry])).toEqual([])
  })

  it('pulls one {toolCallId, action} per SUCCESSFUL proposal, in order', () => {
    const out = extractProposals([readEntry, proposalEntry])
    expect(out).toEqual([{ toolCallId: 'p1', action: scaleAction }])
  })

  it('ignores a FAILED propose call (it stays a chip, not a card)', () => {
    const out = extractProposals([readEntry, failedProposeEntry])
    expect(out).toEqual([])
  })

  it('extracts multiple proposals across a turn, preserving call order', () => {
    const second: ToolTraceEntry = {
      toolCallId: 'p3',
      name: 'propose_log_reading',
      args: {},
      ok: true,
      result: {
        kind: 'proposal',
        action: { type: 'log_reading', title: 'Log reading', preview: 'Add SG 1.03', payload: {} },
      },
    }
    const out = extractProposals([proposalEntry, readEntry, second])
    expect(out.map((p) => p.toolCallId)).toEqual(['p1', 'p3'])
    expect(out[1]?.action.type).toBe('log_reading')
  })
})
