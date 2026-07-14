/**
 * Provider-agnostic AI companion core types (Stage 1: the engine).
 *
 * These are the ONLY shapes the agent loop and tool registry speak. Concrete
 * providers (Anthropic, OpenAI-compatible, local) adapt their wire formats to
 * this small interface in a later stage — nothing here touches `fetch`, an API
 * key, or the DOM. Keeping the contract this thin is what makes the loop
 * unit-testable headlessly with a scripted fake provider.
 */

export type AiRole = 'system' | 'user' | 'assistant' | 'tool'

/** A model-requested tool invocation (also embedded on assistant messages). */
export interface AiToolCall {
  /** Correlates a tool result message back to this call. */
  id: string
  /** Registry tool name, e.g. `calc_recipe`. */
  name: string
  /** Raw arguments the model emitted — validated by the tool's Zod schema in `run`. */
  args: unknown
}

/** A single turn in the conversation, provider-agnostic. */
export interface AiMessage {
  role: AiRole
  content: string
  /** Present on `assistant` messages that requested tool calls. */
  toolCalls?: AiToolCall[]
  /** Present on `tool` messages — which `AiToolCall.id` this result answers. */
  toolCallId?: string
}

/** A JSON-schema object (draft 2020-12), derived from a Zod schema. */
export type JsonSchema = Record<string, unknown>

/**
 * A declarative, read-only tool wrapping an existing repo/calc function.
 * `inputSchema` is the JSON-schema view the provider advertises; `run` re-parses
 * the args with the source Zod schema before doing any work.
 */
export interface AiTool {
  name: string
  description: string
  inputSchema: JsonSchema
  run(args: unknown): Promise<unknown>
}

export type StopReason = 'end' | 'tool_use'

export interface CompleteRequest {
  system?: string
  messages: AiMessage[]
  tools: AiTool[]
}

export interface CompleteResponse {
  /** Assistant text (present when `stopReason === 'end'`, optional otherwise). */
  text?: string
  /** Tool calls to run (present when `stopReason === 'tool_use'`). */
  toolCalls?: AiToolCall[]
  stopReason: StopReason
}

/**
 * The single method every provider implements. Non-streaming this stage:
 * one request in, one decision out (final text OR a batch of tool calls).
 */
export interface ChatProvider {
  complete(req: CompleteRequest): Promise<CompleteResponse>
}
