/**
 * Companion (AI) settings — the bring-your-own-key, local-first config (Stage 2).
 *
 * The brewer picks a provider and supplies a key / baseUrl / model. This slice is
 * persisted LOCALLY only (see `src/stores/companion-settings-store.ts`, localStorage
 * key `brew-companion`) and is sent NOWHERE except the provider the user selects —
 * no telemetry, and the key is never logged. Because it lives in localStorage (not a
 * Dexie table) it stays OUT of the app's data backup/export dump entirely.
 *
 * Two schemas, two jobs:
 *  - `CompanionSettingsSchema` — the lenient PERSISTED shape. A half-finished edit
 *    (blank baseUrl mid-switch) still round-trips through a page reload instead of
 *    being wiped back to defaults.
 *  - `CompanionConfigSchema` — the strict "is this actually usable?" check used by
 *    the factory + Test-connection button. It REJECTS bad config (missing key for a
 *    cloud provider, missing/invalid baseUrl for a local one, empty model, …).
 */

import { z } from 'zod'

export const CompanionProviderSchema = z.enum(['anthropic', 'openai-compatible'])
export type CompanionProvider = z.infer<typeof CompanionProviderSchema>

/**
 * Persisted shape — deliberately lenient so an in-progress edit survives a reload.
 * `baseUrl` is a bare string here (not URL-validated); strictness lives in
 * `CompanionConfigSchema`. `apiKey` is optional (a local model needs no key).
 */
export const CompanionSettingsSchema = z.object({
  provider: CompanionProviderSchema,
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string(),
  schemaVersion: z.literal(1),
})

export type CompanionSettings = z.infer<typeof CompanionSettingsSchema>

/**
 * Strict validation for "can we actually call this?". Same fields, tighter rules:
 *  - `model` must be non-empty.
 *  - `baseUrl` (when present) must be a real URL; it's REQUIRED for openai-compatible.
 *  - `apiKey` is REQUIRED for anthropic (the cloud key), OPTIONAL for openai-compatible
 *    (local Ollama / LM Studio need none).
 */
export const CompanionConfigSchema = z
  .object({
    provider: CompanionProviderSchema,
    apiKey: z.string().optional(),
    baseUrl: z.url().optional(),
    model: z.string().min(1, 'A model is required.'),
    schemaVersion: z.literal(1),
  })
  .superRefine((v, ctx) => {
    if (v.provider === 'openai-compatible' && !v.baseUrl) {
      ctx.addIssue({
        code: 'custom',
        message: 'A base URL is required for an OpenAI-compatible provider.',
        path: ['baseUrl'],
      })
    }
    if (v.provider === 'anthropic' && !v.apiKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'An API key is required for Anthropic.',
        path: ['apiKey'],
      })
    }
  })

/** Sensible out-of-the-box config: Anthropic cloud, current default model, no key yet. */
export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  schemaVersion: 1,
}

/** Handy presets for the OpenAI-compatible baseUrl field (hints only — not enforced). */
export const OPENAI_COMPATIBLE_PRESETS: ReadonlyArray<{
  label: string
  baseUrl: string
  model: string
  needsKey: boolean
}> = [
  {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    needsKey: false,
  },
  {
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    needsKey: false,
  },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet',
    needsKey: true,
  },
]
