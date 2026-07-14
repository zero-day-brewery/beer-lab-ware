/**
 * Anthropic Messages-API adapter (Stage 2 provider).
 *
 * Implements the Stage-1 `ChatProvider` contract EXACTLY — one `complete()` in, one
 * `{text?, toolCalls?, stopReason}` out — by adapting to/from the Anthropic wire
 * format via a single browser-side `fetch`. Bring-your-own-key + local-first: the
 * key rides in the `x-api-key` header of THIS request and nowhere else (never the
 * body, never a log). The `anthropic-dangerous-direct-browser-access` header opts
 * this personal, BYO-key app into calling the API straight from the browser.
 *
 * Wire mapping:
 *   req.system            -> top-level `system`
 *   AiMessage[] (u/a/t)   -> Anthropic messages, incl. assistant `tool_use` blocks
 *                            and `tool_result` (user) blocks; consecutive tool
 *                            results are merged into ONE user turn.
 *   AiTool[]              -> tools: [{ name, description, input_schema }]
 * Response `content[]`    -> concatenated text + `tool_use` blocks
 *   stop_reason==='tool_use' -> 'tool_use', else 'end'.
 */

import type {
  AiMessage,
  AiToolCall,
  ChatProvider,
  CompleteRequest,
  CompleteResponse,
} from '@/lib/ai/types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 1024

type FetchLike = typeof fetch

export interface AnthropicProviderConfig {
  apiKey: string
  model: string
  /** Cap on the response length. Kept small by default so a Test-connection ping is cheap. */
  maxTokens?: number
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike
}

/** One Anthropic message block (text | tool_use | tool_result). */
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: Block[]
}

/**
 * Map the provider-agnostic transcript onto Anthropic's messages array.
 *
 * `tool` turns become `tool_result` blocks inside a `user` message; a run of
 * consecutive tool results is coalesced into a single user turn (Anthropic wants all
 * results for one assistant turn together). `system`-role turns are NOT emitted here
 * — the caller folds them into the top-level `system` field.
 */
function toAnthropicMessages(messages: AiMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]

    if (m.role === 'tool') {
      const content: Block[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        const t = messages[i]
        content.push({ type: 'tool_result', tool_use_id: t.toolCallId ?? '', content: t.content })
        i += 1
      }
      out.push({ role: 'user', content })
      continue
    }

    if (m.role === 'assistant') {
      const content: Block[] = []
      // Only emit a text block for non-empty text — Anthropic rejects empty text blocks.
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
      }
      out.push({ role: 'assistant', content })
      i += 1
      continue
    }

    // 'user' (system-role turns are handled by the caller, not here)
    out.push({ role: 'user', content: [{ type: 'text', text: m.content }] })
    i += 1
  }
  return out
}

/** Fold the request `system` plus any inline `system`-role turns into one string. */
function collectSystem(req: CompleteRequest): string | undefined {
  const parts: string[] = []
  if (req.system) parts.push(req.system)
  for (const m of req.messages) if (m.role === 'system') parts.push(m.content)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

async function errorFromResponse(res: Response): Promise<Error> {
  let detail = res.statusText
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body?.error?.message) detail = body.error.message
  } catch {
    // non-JSON error body — fall back to statusText
  }
  return new Error(`Anthropic API error ${res.status}: ${detail}`)
}

export class AnthropicProvider implements ChatProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly maxTokens: number
  private readonly fetchImpl?: FetchLike

  constructor(config: AnthropicProviderConfig) {
    this.apiKey = config.apiKey
    this.model = config.model
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
    this.fetchImpl = config.fetchImpl
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const doFetch = this.fetchImpl ?? fetch

    const nonSystem = req.messages.filter((m) => m.role !== 'system')
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: toAnthropicMessages(nonSystem),
    }
    const system = collectSystem(req)
    if (system) body.system = system
    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))
    }

    const res = await doFetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw await errorFromResponse(res)

    const data = (await res.json()) as {
      content?: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
      >
      stop_reason?: string
    }

    let text = ''
    const toolCalls: AiToolCall[] = []
    for (const block of data.content ?? []) {
      if (block.type === 'text') text += block.text
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, args: block.input })
      }
    }

    const stopReason = data.stop_reason === 'tool_use' ? 'tool_use' : 'end'
    return {
      text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      stopReason,
    }
  }
}
