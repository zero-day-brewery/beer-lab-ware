/**
 * OpenAI-compatible `/chat/completions` adapter (Stage 2 provider).
 *
 * One adapter covers every backend that speaks the OpenAI Chat Completions shape:
 * OpenAI itself, OpenRouter, and fully-local/offline runtimes like Ollama
 * (`http://localhost:11434/v1`) and LM Studio. Configurable `baseUrl` + `model`;
 * the key is OPTIONAL — a local model needs none, so when there's no key we omit
 * the `Authorization` header entirely (nothing is sent, nothing leaks). When a key
 * IS set it rides in `Authorization: Bearer …` on THIS request only — never the
 * body, never a log.
 *
 * Implements the Stage-1 `ChatProvider` contract EXACTLY. Wire mapping:
 *   req.system            -> a leading { role:'system', content } message
 *   AiMessage[]           -> messages, incl. assistant `tool_calls` and
 *                            role:'tool' results (with `tool_call_id`)
 *   AiTool[]              -> tools: [{ type:'function', function:{ name, description, parameters } }]
 * Response choices[0]     -> { text: message.content, toolCalls: tool_calls.map(...) }
 *   finish_reason==='tool_calls' -> 'tool_use', else 'end'.
 */

import type { AiToolCall, ChatProvider, CompleteRequest, CompleteResponse } from '@/lib/ai/types'

const DEFAULT_MAX_TOKENS = 1024

type FetchLike = typeof fetch

export interface OpenAiCompatibleProviderConfig {
  baseUrl: string
  model: string
  /** Omit for a keyless local endpoint (Ollama / LM Studio). */
  apiKey?: string
  /** Cap on the response length. Kept small by default so a Test-connection ping is cheap. */
  maxTokens?: number
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike
}

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

/** Map the provider-agnostic transcript onto OpenAI chat messages. */
function toOpenAiMessages(req: CompleteRequest): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  if (req.system) out.push({ role: 'system', content: req.system })

  for (const m of req.messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content })
      continue
    }
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const msg: OpenAiMessage = { role: 'assistant', content: m.content ? m.content : null }
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        }))
      }
      out.push(msg)
      continue
    }
    out.push({ role: 'user', content: m.content })
  }
  return out
}

/** OpenAI tool_call arguments arrive as a JSON string; parse, keep the raw on failure. */
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function errorFromResponse(res: Response): Promise<Error> {
  let detail = res.statusText
  try {
    const body = (await res.json()) as { error?: { message?: string } | string }
    const msg = typeof body?.error === 'string' ? body.error : body?.error?.message
    if (msg) detail = msg
  } catch {
    // non-JSON error body — fall back to statusText
  }
  return new Error(`OpenAI-compatible API error ${res.status}: ${detail}`)
}

export class OpenAiCompatibleProvider implements ChatProvider {
  private readonly baseUrl: string
  private readonly model: string
  private readonly apiKey?: string
  private readonly maxTokens: number
  private readonly fetchImpl?: FetchLike

  constructor(config: OpenAiCompatibleProviderConfig) {
    // Trim a trailing slash so `${baseUrl}/chat/completions` never doubles up.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.model = config.model
    this.apiKey = config.apiKey
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
    this.fetchImpl = config.fetchImpl
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const doFetch = this.fetchImpl ?? fetch

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: toOpenAiMessages(req),
    }
    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    // No key (local model) -> no Authorization header at all. The key is only ever
    // attached to the chosen provider's own request.
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const res = await doFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) throw await errorFromResponse(res)

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
        finish_reason?: string
      }>
    }

    const choice = data.choices?.[0]
    const message = choice?.message
    const text = typeof message?.content === 'string' ? message.content : undefined
    const toolCalls: AiToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: parseArgs(tc.function.arguments),
    }))

    const stopReason = choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end'
    return {
      ...(text !== undefined ? { text } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      stopReason,
    }
  }
}
