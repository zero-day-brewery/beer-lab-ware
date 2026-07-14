import { describe, expect, it } from 'vitest'
import {
  CompanionConfigSchema,
  CompanionSettingsSchema,
  DEFAULT_COMPANION_SETTINGS,
} from '@/lib/ai/settings'

describe('CompanionConfigSchema — strict, rejects bad config', () => {
  it('accepts a complete Anthropic config', () => {
    expect(
      CompanionConfigSchema.safeParse({
        provider: 'anthropic',
        apiKey: 'sk-ant',
        model: 'claude-opus-4-8',
        schemaVersion: 1,
      }).success,
    ).toBe(true)
  })

  it('accepts a keyless local openai-compatible config', () => {
    expect(
      CompanionConfigSchema.safeParse({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
        schemaVersion: 1,
      }).success,
    ).toBe(true)
  })

  it('accepts an openai-compatible config with a key', () => {
    expect(
      CompanionConfigSchema.safeParse({
        provider: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or',
        model: 'anthropic/claude-3.5-sonnet',
        schemaVersion: 1,
      }).success,
    ).toBe(true)
  })

  it.each([
    ['unknown provider', { provider: 'gemini', model: 'x', schemaVersion: 1 }],
    ['empty model', { provider: 'anthropic', apiKey: 'k', model: '', schemaVersion: 1 }],
    [
      'anthropic without a key',
      { provider: 'anthropic', model: 'claude-opus-4-8', schemaVersion: 1 },
    ],
    [
      'openai-compatible without a baseUrl',
      { provider: 'openai-compatible', model: 'x', schemaVersion: 1 },
    ],
    [
      'openai-compatible with a non-URL baseUrl',
      {
        provider: 'openai-compatible',
        baseUrl: 'not-a-url',
        model: 'x',
        schemaVersion: 1,
      },
    ],
    ['wrong schemaVersion', { provider: 'anthropic', apiKey: 'k', model: 'x', schemaVersion: 2 }],
  ])('rejects %s', (_label, cfg) => {
    expect(CompanionConfigSchema.safeParse(cfg).success).toBe(false)
  })
})

describe('CompanionSettingsSchema — lenient persisted shape', () => {
  it('round-trips the defaults', () => {
    expect(CompanionSettingsSchema.safeParse(DEFAULT_COMPANION_SETTINGS).success).toBe(true)
  })

  it('allows an in-progress edit (blank baseUrl) that the strict schema would reject', () => {
    const partial = { provider: 'openai-compatible', baseUrl: '', model: '', schemaVersion: 1 }
    expect(CompanionSettingsSchema.safeParse(partial).success).toBe(true)
    expect(CompanionConfigSchema.safeParse(partial).success).toBe(false)
  })

  it('rejects a corrupt blob (missing required fields)', () => {
    expect(CompanionSettingsSchema.safeParse({ provider: 'anthropic' }).success).toBe(false)
    expect(CompanionSettingsSchema.safeParse(null).success).toBe(false)
  })
})

describe('DEFAULT_COMPANION_SETTINGS', () => {
  it('defaults to Anthropic with a current model and no key', () => {
    expect(DEFAULT_COMPANION_SETTINGS.provider).toBe('anthropic')
    expect(DEFAULT_COMPANION_SETTINGS.model).toBe('claude-opus-4-8')
    expect(DEFAULT_COMPANION_SETTINGS.apiKey).toBeUndefined()
  })
})
