/**
 * Provider factory + connection probe (Stage 2).
 *
 * `makeProvider(settings)` binds the brewer's chosen backend (key / baseUrl / model)
 * to the right `ChatProvider` adapter. `testConnection(settings)` validates the
 * config, then fires ONE minimal `complete()` ("ping") to prove the endpoint answers
 * — used by the Settings panel's Test-connection button. The key only ever reaches
 * the provider the user selected; nothing here logs it.
 */

import { AnthropicProvider } from '@/lib/ai/providers/anthropic'
import { OpenAiCompatibleProvider } from '@/lib/ai/providers/openai-compatible'
import { CompanionConfigSchema, type CompanionSettings } from '@/lib/ai/settings'
import type { ChatProvider } from '@/lib/ai/types'

/** Build the adapter for the configured provider, bound to its key/baseUrl/model. */
export function makeProvider(settings: CompanionSettings): ChatProvider {
  if (settings.provider === 'anthropic') {
    return new AnthropicProvider({ apiKey: settings.apiKey ?? '', model: settings.model })
  }
  return new OpenAiCompatibleProvider({
    baseUrl: settings.baseUrl ?? '',
    apiKey: settings.apiKey,
    model: settings.model,
  })
}

export type TestConnectionResult = { ok: true; model: string } | { ok: false; error: string }

/**
 * Validate the config, then send a 1-token "ping" through the real adapter.
 * Returns `{ok:true}` on any successful response, `{ok:false,error}` on a bad config
 * or a failed request. Never throws — the caller renders `error` inline.
 */
export async function testConnection(settings: CompanionSettings): Promise<TestConnectionResult> {
  const parsed = CompanionConfigSchema.safeParse(settings)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid configuration.' }
  }
  try {
    const provider = makeProvider(parsed.data)
    await provider.complete({ messages: [{ role: 'user', content: 'ping' }], tools: [] })
    return { ok: true, model: parsed.data.model }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export { AnthropicProvider } from '@/lib/ai/providers/anthropic'
export { OpenAiCompatibleProvider } from '@/lib/ai/providers/openai-compatible'
