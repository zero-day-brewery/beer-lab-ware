import { describe, expect, it } from 'vitest'
import { FakeProvider, finalText, toolUse } from '@/lib/ai/__fixtures__/fake-provider'
import { runAgent } from '@/lib/ai/agent'
import type { AiMessage, AiTool } from '@/lib/ai/types'

// ── tiny in-test tool registry (no Zod needed to exercise the loop) ────────
const echo: AiTool = {
  name: 'echo',
  description: 'echo the args back',
  inputSchema: { type: 'object' },
  run: async (args) => args,
}
const add: AiTool = {
  name: 'add',
  description: 'add a + b',
  inputSchema: { type: 'object' },
  run: async (args) => {
    const { a, b } = args as { a: number; b: number }
    return a + b
  },
}
const boom: AiTool = {
  name: 'boom',
  description: 'always throws',
  inputSchema: { type: 'object' },
  run: async () => {
    throw new Error('kaboom')
  },
}

const tools = [echo, add, boom]
const userMsg = (content: string): AiMessage => ({ role: 'user', content })

describe('runAgent — the agent loop', () => {
  it('(a) runs a tool_use, feeds the result back, then returns the end text', async () => {
    const provider = new FakeProvider([
      toolUse([{ id: 't1', name: 'echo', args: { hello: 'world' } }]),
      finalText('all done'),
    ])
    const result = await runAgent({ provider, tools, messages: [userMsg('hi')] })

    expect(result.stopReason).toBe('end')
    expect(result.text).toBe('all done')
    expect(result.iterations).toBe(2)
    expect(result.toolTrace).toHaveLength(1)
    expect(result.toolTrace[0]).toMatchObject({
      name: 'echo',
      ok: true,
      result: { hello: 'world' },
    })

    // The tool result was appended as a `tool` message the model could read.
    const toolMsg = result.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.toolCallId).toBe('t1')
    expect(toolMsg?.content).toBe(JSON.stringify({ hello: 'world' }))
  })

  it('(b) handles multiple SEQUENTIAL tool calls across iterations', async () => {
    const provider = new FakeProvider([
      toolUse([{ id: 'a', name: 'add', args: { a: 1, b: 2 } }]),
      toolUse([{ id: 'b', name: 'add', args: { a: 10, b: 5 } }]),
      finalText('sums are 3 and 15'),
    ])
    const result = await runAgent({ provider, tools, messages: [userMsg('add stuff')] })

    expect(result.iterations).toBe(3)
    expect(result.toolTrace.map((t) => t.result)).toEqual([3, 15])
    expect(result.text).toBe('sums are 3 and 15')
  })

  it('(b2) handles multiple tool calls in a SINGLE turn', async () => {
    const provider = new FakeProvider([
      toolUse([
        { id: 'p1', name: 'add', args: { a: 2, b: 2 } },
        { id: 'p2', name: 'echo', args: { k: 'v' } },
      ]),
      finalText('parallel done'),
    ])
    const result = await runAgent({ provider, tools, messages: [userMsg('go')] })

    expect(result.iterations).toBe(2)
    expect(result.toolTrace).toHaveLength(2)
    expect(result.toolTrace[0]).toMatchObject({ toolCallId: 'p1', result: 4 })
    expect(result.toolTrace[1]).toMatchObject({ toolCallId: 'p2', result: { k: 'v' } })
    expect(result.messages.filter((m) => m.role === 'tool')).toHaveLength(2)
  })

  it('(c) a throwing tool is surfaced as a tool message; the loop continues, no crash', async () => {
    const provider = new FakeProvider([
      toolUse([{ id: 'x', name: 'boom', args: {} }]),
      finalText('recovered gracefully'),
    ])
    const result = await runAgent({ provider, tools, messages: [userMsg('break it')] })

    expect(result.stopReason).toBe('end')
    expect(result.text).toBe('recovered gracefully')
    expect(result.toolTrace[0]).toMatchObject({ name: 'boom', ok: false })
    expect(result.toolTrace[0].error).toMatch(/kaboom/)

    const toolMsg = result.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toMatch(/^Error: /)
  })

  it('(c2) an unknown tool name is surfaced as an error, not a throw', async () => {
    const provider = new FakeProvider([
      toolUse([{ id: 'u', name: 'ghost', args: {} }]),
      finalText('ok'),
    ])
    const result = await runAgent({ provider, tools, messages: [userMsg('call ghost')] })

    expect(result.toolTrace[0]).toMatchObject({ name: 'ghost', ok: false })
    expect(result.toolTrace[0].error).toMatch(/Unknown tool/)
    expect(result.text).toBe('ok')
  })

  it('(d) the iteration cap trips and returns gracefully (never loops forever)', async () => {
    // Fallback ALWAYS asks for a tool → the model never emits `end`.
    const provider = new FakeProvider([], toolUse([{ id: 'loop', name: 'echo', args: {} }]))
    const result = await runAgent({
      provider,
      tools,
      messages: [userMsg('spin')],
      maxIterations: 3,
    })

    expect(result.stopReason).toBe('max_iterations')
    expect(result.iterations).toBe(3)
    expect(provider.callCount).toBe(3)
    expect(result.toolTrace).toHaveLength(3)
    expect(result.text).toMatch(/3-iteration limit/)
  })

  it('forwards system + tools to the provider and does not mutate the caller messages', async () => {
    const provider = new FakeProvider([finalText('hi')])
    const original: AiMessage[] = [userMsg('question')]
    const result = await runAgent({
      provider,
      tools,
      messages: original,
      system: 'You are a brewing companion.',
    })

    expect(provider.calls[0].system).toBe('You are a brewing companion.')
    expect(provider.calls[0].tools).toBe(tools)
    expect(original).toHaveLength(1) // caller array untouched
    expect(result.messages).not.toBe(original)
  })
})
