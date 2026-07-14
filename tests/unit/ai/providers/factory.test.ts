import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeProvider, testConnection } from '@/lib/ai/providers'
import { AnthropicProvider } from '@/lib/ai/providers/anthropic'
import { OpenAiCompatibleProvider } from '@/lib/ai/providers/openai-compatible'
import type { CompanionSettings } from '@/lib/ai/settings'

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

const anthropicSettings: CompanionSettings = {
  provider: 'anthropic',
  apiKey: 'sk-ant-secret',
  model: 'claude-opus-4-8',
  schemaVersion: 1,
}

const openaiSettings: CompanionSettings = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-oai',
  model: 'gpt-4o-mini',
  schemaVersion: 1,
}

const localSettings: CompanionSettings = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.1',
  schemaVersion: 1,
}

describe('makeProvider — factory', () => {
  it('returns an AnthropicProvider for the anthropic provider', () => {
    expect(makeProvider(anthropicSettings)).toBeInstanceOf(AnthropicProvider)
  })

  it('returns an OpenAiCompatibleProvider for the openai-compatible provider', () => {
    expect(makeProvider(openaiSettings)).toBeInstanceOf(OpenAiCompatibleProvider)
  })

  it('routes the request to the Anthropic endpoint with the bound key', async () => {
    const mock = stubFetch(
      mockResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
    )
    await makeProvider(anthropicSettings).complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    })

    const [url, opts] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret')
  })

  it('routes the request to {baseUrl}/chat/completions for openai-compatible', async () => {
    const mock = stubFetch(
      mockResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    )
    await makeProvider(localSettings).complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    })

    const [url, opts] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    // keyless local -> no Authorization header
    expect('Authorization' in (opts.headers as Record<string, string>)).toBe(false)
  })
})

describe('testConnection', () => {
  it('returns ok on a successful 1-token ping', async () => {
    const mock = stubFetch(
      mockResponse({ content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn' }),
    )
    const res = await testConnection(anthropicSettings)

    expect(res).toEqual({ ok: true, model: 'claude-opus-4-8' })
    // the ping is a minimal single-message request
    const body = JSON.parse((mock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'ping' }] }])
  })

  it('returns an error (with the status) when the endpoint rejects the request', async () => {
    stubFetch(mockResponse({ error: { message: 'invalid x-api-key' } }, { ok: false, status: 401 }))
    const res = await testConnection(anthropicSettings)

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/401/)
  })

  it('rejects a bad config WITHOUT hitting the network', async () => {
    const mock = stubFetch(mockResponse({}))
    // openai-compatible with no baseUrl -> invalid
    const bad: CompanionSettings = { provider: 'openai-compatible', model: 'x', schemaVersion: 1 }
    const res = await testConnection(bad)

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/base URL/i)
    expect(mock).not.toHaveBeenCalled()
  })
})
