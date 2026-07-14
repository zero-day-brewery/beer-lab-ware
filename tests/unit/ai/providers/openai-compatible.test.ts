import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleProvider } from '@/lib/ai/providers/openai-compatible'
import type { AiMessage, AiTool } from '@/lib/ai/types'

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
  name: 'get_recipe',
  description: 'Get one recipe.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  run: async () => ({}),
}

const transcript: AiMessage[] = [
  { role: 'user', content: 'hi' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call_1', name: 'get_recipe', args: { id: 'r1' } }],
  },
  { role: 'tool', toolCallId: 'call_1', content: '{"ok":true}' },
]

describe('OpenAiCompatibleProvider.complete — request shaping', () => {
  it('POSTs {baseUrl}/chat/completions with Bearer auth, functions, and tool-role mapping', async () => {
    const mock = stubFetch(
      mockResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    )

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-oai-secret',
      model: 'gpt-4o-mini',
    })
    await provider.complete({ system: 'sys', messages: transcript, tools: [tool] })

    const [url, opts] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(opts.method).toBe('POST')

    const headers = opts.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-oai-secret')
    expect(headers['content-type']).toBe('application/json')

    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('gpt-4o-mini')
    // system as a leading system message; assistant tool_calls; tool role w/ tool_call_id
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_recipe', arguments: '{"id":"r1"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ])
    // tools -> [{ type:'function', function:{ name, description, parameters } }]
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_recipe',
          description: 'Get one recipe.',
          parameters: tool.inputSchema,
        },
      },
    ])
    // key only in the header, never the body
    expect(opts.body as string).not.toContain('sk-oai-secret')
  })

  it('trims a trailing slash on baseUrl', async () => {
    const mock = stubFetch(
      mockResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }),
    )
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:11434/v1/',
      model: 'llama3.1',
    })
    await provider.complete({ messages: [{ role: 'user', content: 'ping' }], tools: [] })

    expect(mock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('sends NO Authorization header for a keyless local endpoint', async () => {
    const mock = stubFetch(
      mockResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }),
    )
    // Local Ollama — no apiKey.
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
    })
    await provider.complete({ messages: [{ role: 'user', content: 'ping' }], tools: [] })

    const headers = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect('Authorization' in headers).toBe(false)
  })
})

describe('OpenAiCompatibleProvider.complete — response parsing', () => {
  it('reads content + ends the turn', async () => {
    stubFetch(
      mockResponse({ choices: [{ message: { content: 'Use Citra.' }, finish_reason: 'stop' }] }),
    )
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', model: 'm' })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })

    expect(res.text).toBe('Use Citra.')
    expect(res.toolCalls).toBeUndefined()
    expect(res.stopReason).toBe('end')
  })

  it('maps tool_calls (finish_reason "tool_calls") and parses JSON arguments', async () => {
    stubFetch(
      mockResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_9',
                  type: 'function',
                  function: { name: 'calc_recipe', arguments: '{"volume_L":40}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', model: 'm' })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })

    expect(res.text).toBeUndefined()
    expect(res.toolCalls).toEqual([{ id: 'call_9', name: 'calc_recipe', args: { volume_L: 40 } }])
    expect(res.stopReason).toBe('tool_use')
  })

  it('keeps the raw string when tool_call arguments are not valid JSON', async () => {
    stubFetch(
      mockResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'x', arguments: 'not-json' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', model: 'm' })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] })
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'x', args: 'not-json' }])
  })
})

describe('OpenAiCompatibleProvider.complete — errors', () => {
  it('throws a clear Error with the status + message on a non-200', async () => {
    stubFetch(
      mockResponse(
        { error: { message: 'model not found' } },
        {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        },
      ),
    )
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', model: 'nope' })
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] }),
    ).rejects.toThrow(/OpenAI-compatible API error 404: model not found/)
  })
})
