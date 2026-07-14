import { describe, expect, it } from 'vitest'
import { toolChips } from '@/components/ai/tool-chips'
import type { ToolTraceEntry } from '@/lib/ai/agent'

const entry = (p: Partial<ToolTraceEntry>): ToolTraceEntry => ({
  toolCallId: 'x',
  name: 'list_inventory',
  args: {},
  ok: true,
  ...p,
})

describe('toolChips — toolTrace → chip labels', () => {
  it('maps each read tool to a friendly present-tense label', () => {
    const chips = toolChips([
      entry({ name: 'list_inventory' }),
      entry({ name: 'inventory_report' }),
      entry({ name: 'list_batches' }),
      entry({ name: 'batch_stats' }),
    ])
    expect(chips.map((c) => c.label)).toEqual([
      'read your inventory',
      'checked your pantry',
      'read your brew log',
      'rolled up your brew stats',
    ])
  })

  it('names a calc chip from the recipe in the args', () => {
    const [chip] = toolChips([
      entry({ name: 'calc_recipe', args: { recipe: { name: 'West Coast IPA' } } }),
    ])
    expect(chip.label).toBe('calculated West Coast IPA')
  })

  it('names a get_recipe chip from the result name', () => {
    const [chip] = toolChips([
      entry({ name: 'get_recipe', args: { id: 'r1' }, result: { name: 'Hazy Pale' } }),
    ])
    expect(chip.label).toBe('read Hazy Pale')
  })

  it('flags a failed call and keeps its verb', () => {
    const [chip] = toolChips([entry({ name: 'list_inventory', ok: false, error: 'boom' })])
    expect(chip.ok).toBe(false)
    expect(chip.label).toBe('read your inventory — failed')
  })

  it('returns no chips for an empty or missing trace', () => {
    expect(toolChips([])).toEqual([])
    expect(toolChips(undefined)).toEqual([])
  })
})
