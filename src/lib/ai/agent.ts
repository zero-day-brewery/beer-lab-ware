/**
 * The agent loop (Stage 1: the engine).
 *
 * Pure orchestration over a `ChatProvider` + an `AiTool[]` registry:
 *   complete() → if the model asks for tools, run them, feed results back, loop →
 *   until the model returns final text OR the iteration cap trips.
 *
 * Deterministic by construction: no `Date`, no `fetch`, no globals — everything
 * time/IO-dependent lives behind the injected provider and the tools' own deps.
 * A thrown tool (bad Zod input, missing tool, repo error) is CAUGHT and fed back
 * to the model as a tool-result message; it never escapes the loop.
 */

import type { AiMessage, AiTool, ChatProvider } from '@/lib/ai/types'

export interface ToolTraceEntry {
  toolCallId: string
  name: string
  args: unknown
  ok: boolean
  result?: unknown
  error?: string
}

export interface RunAgentOptions {
  provider: ChatProvider
  tools: AiTool[]
  messages: AiMessage[]
  system?: string
  /** Hard cap on `provider.complete()` calls. Bounds cost/latency. */
  maxIterations?: number
}

export interface AgentRunResult {
  /** Final assistant text (or the last text seen when the cap trips). */
  text: string
  /** Full transcript incl. assistant tool-call turns and tool-result turns. */
  messages: AiMessage[]
  /** Every tool invocation, in order, with its result or error. */
  toolTrace: ToolTraceEntry[]
  /** How many `complete()` calls were made. */
  iterations: number
  stopReason: 'end' | 'max_iterations'
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Run the read-only companion agent to completion (or the iteration cap).
 *
 * The caller's `messages` array is never mutated — a working copy is returned in
 * the result. Tool errors are surfaced as `tool` messages so the model can
 * recover on the next turn instead of the whole run crashing.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const { provider, tools, system } = opts
  const maxIterations = opts.maxIterations ?? 6
  const byName = new Map(tools.map((t) => [t.name, t]))

  const messages: AiMessage[] = [...opts.messages]
  const toolTrace: ToolTraceEntry[] = []
  let lastText = ''
  let iterations = 0

  while (iterations < maxIterations) {
    iterations += 1
    const res = await provider.complete({ system, messages, tools })
    if (typeof res.text === 'string') lastText = res.text

    if (res.stopReason === 'end') {
      return { text: res.text ?? lastText, messages, toolTrace, iterations, stopReason: 'end' }
    }

    // stopReason === 'tool_use': record the assistant's request, then run each call.
    const calls = res.toolCalls ?? []
    messages.push({ role: 'assistant', content: res.text ?? '', toolCalls: calls })

    for (const call of calls) {
      const tool: AiTool | undefined = byName.get(call.name)
      if (!tool) {
        const error = `Unknown tool: ${call.name}`
        toolTrace.push({ toolCallId: call.id, name: call.name, args: call.args, ok: false, error })
        messages.push({ role: 'tool', toolCallId: call.id, content: `Error: ${error}` })
        continue
      }
      try {
        const result = await tool.run(call.args)
        toolTrace.push({ toolCallId: call.id, name: call.name, args: call.args, ok: true, result })
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) })
      } catch (err) {
        const error = errText(err)
        toolTrace.push({ toolCallId: call.id, name: call.name, args: call.args, ok: false, error })
        messages.push({ role: 'tool', toolCallId: call.id, content: `Error: ${error}` })
      }
    }
  }

  // Cap tripped: return gracefully with whatever text we last saw + a clear reason.
  return {
    text: lastText || `Stopped after the ${maxIterations}-iteration limit without a final answer.`,
    messages,
    toolTrace,
    iterations,
    stopReason: 'max_iterations',
  }
}
