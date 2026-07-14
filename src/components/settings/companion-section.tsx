'use client'
import { useState } from 'react'
import { testConnection } from '@/lib/ai/providers'
import { type CompanionProvider, OPENAI_COMPATIBLE_PRESETS } from '@/lib/ai/settings'
import { useCompanionSettingsStore } from '@/stores/companion-settings-store'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

/**
 * AI Companion settings — bring-your-own-provider config.
 *
 * Token-driven (reuses `.field` / `.btn-*` / `.tap-card`). Lets the brewer pick a
 * provider, enter a key / baseUrl / model, and Test-connection. Everything stays
 * local (localStorage via the companion store); the key is only ever sent to the
 * provider the user picks. The privacy note spells that out.
 */
export function CompanionSection() {
  const { settings, update } = useCompanionSettingsStore()
  const [test, setTest] = useState<TestState>({ kind: 'idle' })

  const isLocalStyle = settings.provider === 'openai-compatible'

  const onProvider = (provider: CompanionProvider) => {
    setTest({ kind: 'idle' })
    if (provider === 'anthropic') {
      // A leftover OpenAI-style model id won't work on Anthropic — restore a sane default.
      const model = settings.model.startsWith('claude') ? settings.model : 'claude-opus-4-8'
      update({ provider, model })
    } else {
      update({ provider })
    }
  }

  const applyPreset = (baseUrl: string, model: string) => {
    setTest({ kind: 'idle' })
    update({ baseUrl, model })
  }

  const onTest = async () => {
    setTest({ kind: 'testing' })
    const res = await testConnection(settings)
    setTest(
      res.ok
        ? { kind: 'ok', message: `Connected — ${res.model} responded.` }
        : { kind: 'error', message: res.error },
    )
  }

  return (
    <section className="tap-card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">🤖 Brewing companion</span>
        <h2 className="text-lg font-semibold">AI Companion</h2>
        <p className="text-sm text-muted-foreground">
          Bring your own AI. Pick a provider and enter your key — it lives only in this browser.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Provider</span>
        <select
          aria-label="AI provider"
          value={settings.provider}
          onChange={(e) => onProvider(e.target.value as CompanionProvider)}
          className="field"
        >
          <option value="anthropic">Anthropic (Claude) — cloud</option>
          <option value="openai-compatible">
            OpenAI-compatible (OpenAI / OpenRouter / Ollama / LM Studio)
          </option>
        </select>
      </label>

      {isLocalStyle && (
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Base URL</span>
            <input
              type="text"
              aria-label="Base URL"
              inputMode="url"
              placeholder="http://localhost:11434/v1"
              value={settings.baseUrl ?? ''}
              onChange={(e) => {
                setTest({ kind: 'idle' })
                update({ baseUrl: e.target.value })
              }}
              className="field"
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            {OPENAI_COMPATIBLE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.baseUrl, p.model)}
                className="btn-ghost"
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Local runtimes (Ollama, LM Studio) need no key and stay fully offline.
          </p>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          API key{' '}
          {isLocalStyle && <span className="text-muted-foreground">(optional for local)</span>}
        </span>
        <input
          type="password"
          aria-label="API key"
          autoComplete="off"
          placeholder={isLocalStyle ? 'leave blank for a local model' : 'sk-…'}
          value={settings.apiKey ?? ''}
          onChange={(e) => {
            setTest({ kind: 'idle' })
            update({ apiKey: e.target.value })
          }}
          className="field"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Model</span>
        <input
          type="text"
          aria-label="Model"
          placeholder={isLocalStyle ? 'llama3.1' : 'claude-opus-4-8'}
          value={settings.model}
          onChange={(e) => {
            setTest({ kind: 'idle' })
            update({ model: e.target.value })
          }}
          className="field"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={test.kind === 'testing'}
          className="btn-primary disabled:opacity-50"
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {test.kind === 'ok' && <span className="text-sm text-primary">✓ {test.message}</span>}
        {test.kind === 'error' && (
          <span className="text-sm text-destructive">✕ {test.message}</span>
        )}
      </div>

      <p className="rounded-md border border-border/70 bg-card/40 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Privacy.</strong> With a cloud provider (Anthropic,
        OpenAI, OpenRouter), the brewing data you ask about is sent to that provider to answer. A
        local model (Ollama / LM Studio) keeps everything on your device. Your key is stored only in
        this browser and is sent only to the provider you choose — never to us, never anywhere else.
      </p>
    </section>
  )
}
