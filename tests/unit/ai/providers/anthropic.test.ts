import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from '@/lib/ai/providers/anthropic'
import type { AiMessage, AiTool } from '@/lib/ai/types'

// ── mocked fetch (never a real network call) ───────────────────────────────
function mockResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  } as unknown as Response
}

function stubFetch(res: Response) {
  const mock = vi.fn<typeof fetch>(async () => res)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const tool: AiTool = {
  name: 'list_inventory',
  description: 'List pantry items.',
  inputSchema: { type: 'object', properties: { kind: { type: 'string' } } },
  run: async () => ({}),
}

// A transcript that exercises tool_use (assistant) + tool_result (user) mapping.
const transcript: AiMessage[] = [
  { role: 'user', content: 'what should I brew?' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'tu_1', name: 'list_inventory', args: { kind: 'hop' } }],
  },
  { role: 'tool', toolCallId: 'tu_1', content: '{"items":[]}' },
]

describe('AnthropicProvider.complete — request shaping', () => {
  it('POSTs the browser-direct Messages API with the right URL, headers, and body', async () => {
    const mock = stubFetch(
      mockResponse({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }),
    )

    const provider = new AnthropicProvider({ apiKey: 'sk-ant-secret', model: 'claude-opus-4-8' })
    await provider.complete({
      system: 'You are a brewing expert.',
      messages: transcript,
      tools: [tool],
    })

    const [url, opts] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(opts.method).toBe('POST')

    const headers = opts.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-secret')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headers['content-type']).toBe('application/json')

    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('claude-opus-4-8')
    expect(typeof body.max_tokens).toBe('number')
    // system -> top-level
    expect(body.system).toBe('You are a brewing expert.')
    // AiTool[] -> tools: [{ name, description, input_schema }]
    expect(body.tools).toEqual([
      { name: 'list_inventory', description: 'List pantry items.', input_schema: tool.inputSchema },
    ])
    // messages: user text, assistant tool_use block, user tool_result block
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'what should I brew?' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'list_inventory', input: { kind: 'hop' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"items":[]}' }],
      },
    ])
  })

  it('places the key ONLY in the x-api-key header — never in the request body', async () => {
    const mock = stubFetch(mockResponse({ content: [], stop_reason: 'end_turn' }))
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-secret', model: 'claude-opus-4-8' })
    await provider.complete({ messages: [{ role: 'user', content: 'ping' }], tools: [] })

    const [, opts] = mock.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret')
    expect(opts.body as string).not.toContain('sk-ant-secret')
  })

  it('omits tools when the registry is empty and folds inline system-role turns into system', async () => {
    const mock = stubFetch(mockResponse({ content: [], stop_reason: 'end_turn' }))
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-4-8' })
    await provider.complete({
      system: 'base',
      messages: [
        { role: 'system', content: 'extra' },
        { role: 'user', content: 'hi' },
      ],
      tools: [],
    })

    const body = JSON.parse((mock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.tools).toBeUndefined()
    expect(body.system).toBe('base\n\nextra')
    // the system-role turn is not emitted as a message
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  })
})

describe('AnthropicProvider.complete — response parsing', () => {
  it('concatenates text blocks and ends the turn', async () => {
    stubFetch(
      mockResponse({
        content: [
          { type: 'text', text: 'Brew a ' },
          { type: 'text', text: 'SMaSH.' },
        ],
        stop_reason: 'end_turn',
      }),
    )
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-4-8' })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })

    expect(res.text).toBe('Brew a SMaSH.')
    expect(res.toolCalls).toBeUndefined()
    expect(res.stopReason).toBe('end')
  })

  it('extracts tool_use blocks and maps stop_reason "tool_use"', async () => {
    stubFetch(
      mockResponse({
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'tu_9', name: 'calc_recipe', input: { volume_L: 20 } },
        ],
        stop_reason: 'tool_use',
      }),
    )
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-4-8' })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })

    expect(res.text).toBe('let me check')
    expect(res.toolCalls).toEqual([{ id: 'tu_9', name: 'calc_recipe', args: { volume_L: 20 } }])
    expect(res.stopReason).toBe('tool_use')
  })
})

describe('AnthropicProvider.complete — errors', () => {
  it('throws a clear Error with the status + message on a non-200', async () => {
    stubFetch(
      mockResponse(
        { error: { message: 'invalid x-api-key' } },
        {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        },
      ),
    )
    const provider = new AnthropicProvider({ apiKey: 'bad', model: 'claude-opus-4-8' })
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] }),
    ).rejects.toThrow(/Anthropic API error 401: invalid x-api-key/)
  })
})
