'use client'
/**
 * The AI brewing companion — a slide-over chat drawer (Stage 3).
 *
 * Wires Stage 1 (the agent loop + read-only tools) to Stage 2 (provider adapters +
 * bring-your-own-key settings) behind a chat UI reachable from every page. On send
 * it composes a grounding system prompt + the running transcript and hands off to
 * `runAgent`, then renders the assistant's markdown answer plus a chip per tool the
 * agent called (from the returned `toolTrace`) so the brewer sees what it read/ran.
 *
 * v2: the registry is the FULL set (`buildAllTools` = read + PROPOSE tools), so the
 * model can PROPOSE a change (scale a recipe, log a reading, adjust inventory, create
 * a recipe). A proposal rides in the same `toolTrace` (result `{kind:'proposal',
 * action}`) and renders as an Approve/Discard action card under the message that
 * proposed it. SAFETY INVARIANT: the agent only proposes — the WRITE (`applyAction`)
 * happens ONLY from the human's Approve click, never in the loop or on render.
 *
 * No config? → a friendly "set up your AI" panel instead of an input. Any
 * provider/tool error renders as an error bubble; the drawer never crashes.
 *
 * The provider is INJECTABLE (`providerFactory`, default `makeProvider`), as are the
 * `tools` and the `apply` write function, so tests drive it with a scripted fake
 * provider, a toy registry, and a fake `applyAction` — no network, no Dexie.
 */
import { Bot, CircleAlert, Send, Sparkles, Wrench, X } from 'lucide-react'
import Link from 'next/link'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { type ApplyResult, applyAction } from '@/lib/ai/actions/apply'
import type { ActionDescriptor } from '@/lib/ai/actions/types'
import type { AgentRunResult, ToolTraceEntry } from '@/lib/ai/agent'
import { runAgent } from '@/lib/ai/agent'
import { makeProvider } from '@/lib/ai/providers'
import { CompanionConfigSchema, type CompanionSettings } from '@/lib/ai/settings'
import { buildAllTools } from '@/lib/ai/tools'
import { defaultToolDeps } from '@/lib/ai/tools/deps'
import type { AiMessage, AiTool, ChatProvider } from '@/lib/ai/types'
import type { Insight, InsightSeverity } from '@/lib/brewing/insights/types'
import { useCompanionSettingsStore } from '@/stores/companion-settings-store'
import { ActionCard } from './action-card'
import { COMPANION_SYSTEM_PROMPT } from './companion-system-prompt'
import { Markdown } from './markdown'
import { extractProposals } from './proposals'
import { toolChips } from './tool-chips'
import { maxSeverity, severityTint } from './use-insights'

/** A single rendered turn in the chat (decoupled from the raw agent transcript). */
interface DisplayTurn {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  toolTrace?: ToolTraceEntry[]
}

export interface CompanionDrawerProps {
  open: boolean
  onClose: () => void
  /** Injectable for tests — defaults to the real provider factory. */
  providerFactory?: (settings: CompanionSettings) => ChatProvider
  /**
   * Injectable for tests — defaults to the v2 FULL registry (read + propose
   * tools) so the model can propose changes. A read-only registry can be forced
   * by passing `buildTools(defaultToolDeps)`.
   */
  tools?: AiTool[]
  /** Injectable for tests — defaults to the real agent loop. */
  runner?: typeof runAgent
  /**
   * The write path invoked from an action card's Approve click. Injectable for
   * tests; defaults to the real `applyAction` (the sole Stage-A write path).
   * NEVER called on render/mount or inside the agent loop.
   */
  apply?: (action: ActionDescriptor) => Promise<ApplyResult>
  /**
   * v3 Stage B — the ranked, token-free proactive insights to surface as a
   * "Heads up" panel atop the message area. Detection is local (no AI); the
   * model is only invoked when the brewer clicks "Ask about this". Defaults to
   * none so v1/v2 callers/tests are unaffected.
   */
  insights?: Insight[]
  /** Drop a surfaced insight (wired to `useInsights().dismiss`). */
  onDismiss?: (id: string) => void
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

let turnSeq = 0
const nextId = () => {
  turnSeq += 1
  return `turn-${turnSeq}`
}

export function CompanionDrawer({
  open,
  onClose,
  providerFactory = makeProvider,
  tools,
  runner = runAgent,
  apply = applyAction,
  insights = [],
  onDismiss,
}: CompanionDrawerProps) {
  const settings = useCompanionSettingsStore((s) => s.settings)
  const config = useMemo(() => CompanionConfigSchema.safeParse(settings), [settings])
  const isConfigured = config.success

  const registry = useMemo(() => tools ?? buildAllTools(defaultToolDeps), [tools])

  // `convo` = the raw transcript we feed back to the agent; `turns` = what we render.
  const [convo, setConvo] = useState<AiMessage[]>([])
  const [turns, setTurns] = useState<DisplayTurn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const listEndRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  // Focus the most useful control when the drawer opens.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      if (isConfigured) inputRef.current?.focus()
      else closeRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open, isConfigured])

  // Keep the newest message in view. (`?.()` — scrollIntoView is absent under jsdom.)
  useEffect(() => {
    if (open) listEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [open])
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns/thinking are re-run triggers, not read
  useEffect(() => {
    listEndRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [turns, thinking])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    // Simple focus trap: keep Tab cycling inside the drawer.
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    )
    if (nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  /**
   * Send a message through the real agent loop. Pass `explicit` to send text
   * that isn't (yet) committed to the composer state — used by "Ask about this",
   * which seeds the composer AND fires the send in the same tick without racing
   * the async `setInput`. With no arg it sends the current composer contents.
   */
  async function send(explicit?: string) {
    const text = (explicit ?? input).trim()
    if (!text || thinking || !config.success) return

    const userTurn: DisplayTurn = { id: nextId(), role: 'user', content: text }
    const nextConvo: AiMessage[] = [...convo, { role: 'user', content: text }]
    setTurns((prev) => [...prev, userTurn])
    setInput('')
    setThinking(true)

    try {
      const result: AgentRunResult = await runner({
        provider: providerFactory(config.data),
        tools: registry,
        messages: nextConvo,
        system: COMPANION_SYSTEM_PROMPT,
      })
      // Re-seed the transcript with the full run PLUS the final assistant text so
      // the next turn has coherent history (runAgent omits the closing text turn).
      setConvo([...result.messages, { role: 'assistant', content: result.text }])
      setTurns((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: result.text,
          toolTrace: result.toolTrace,
        },
      ])
    } catch (err) {
      // Keep the user's message in the transcript; surface the failure as a bubble.
      setConvo(nextConvo)
      setTurns((prev) => [...prev, { id: nextId(), role: 'error', content: errText(err) }])
    } finally {
      setThinking(false)
    }
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  /**
   * "Ask about this" — seed the composer with the insight's grounded question
   * (falls back to a sensible prompt from the title) and fire the SAME send path
   * so it runs the agent (v1 read tools + v2 propose). When the AI isn't
   * configured, `send` no-ops just like a normal send and the setup panel that's
   * already showing stays put — detection/surfacing never needed a key.
   */
  function askAbout(insight: Insight) {
    const seeded = insight.ask ?? `Tell me about this: ${insight.title}`
    setInput(seeded)
    void send(seeded)
  }

  const providerLabel = settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'

  return (
    <div className="companion-overlay">
      <button
        type="button"
        className="companion-scrim"
        aria-label="Dismiss companion"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="companion-drawer tap-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
      >
        <header className="companion-head">
          <div className="companion-head-title">
            <span aria-hidden="true" className="companion-head-glyph">
              <Bot size={18} />
            </span>
            <div className="companion-head-text">
              <h2 id={headingId} className="companion-title">
                Brewing companion
              </h2>
              <p className="companion-sub">
                {providerLabel}
                {settings.model ? ` · ${settings.model}` : ''}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            aria-label="Close companion"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="companion-body" aria-live="polite" aria-atomic="false">
          {insights.length > 0 && (
            <HeadsUp insights={insights} onAsk={askAbout} onDismiss={onDismiss} />
          )}

          {turns.length === 0 && (
            <div className="companion-empty">
              <span aria-hidden="true" className="companion-empty-glyph">
                <Sparkles size={22} />
              </span>
              <p className="companion-empty-title">Ask about your brewing.</p>
              <p className="companion-empty-hint">
                “What should I brew with what I have?” · “Scale my IPA to 40 L” · “Gravity’s stuck
                at 1.030 — what now?”
              </p>
            </div>
          )}

          {turns.map((turn) => (
            <Turn key={turn.id} turn={turn} apply={apply} />
          ))}

          {thinking && (
            <div className="companion-msg assistant" role="status">
              <span className="sr-only">Companion is thinking…</span>
              <div className="companion-thinking" aria-hidden="true">
                <span className="companion-dot" />
                <span className="companion-dot" />
                <span className="companion-dot" />
              </div>
            </div>
          )}
          <div ref={listEndRef} />
        </div>

        {isConfigured ? (
          <form
            className="companion-input"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <textarea
              ref={inputRef}
              className="field companion-textarea"
              placeholder="Ask your brewing companion…"
              aria-label="Message the brewing companion"
              rows={2}
              value={input}
              disabled={thinking}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="submit"
              className="btn-primary companion-send"
              aria-label="Send message"
              disabled={thinking || input.trim() === ''}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <div className="companion-setup" role="note">
            <span aria-hidden="true" className="companion-setup-glyph">
              <Wrench size={18} />
            </span>
            <p className="companion-setup-title">Set up your AI first</p>
            <p className="companion-setup-hint">
              Choose a provider and add your key (or point at a local model) to start chatting.
              Everything stays in this browser.
            </p>
            <Link href="/settings" className="btn-primary companion-setup-link" onClick={onClose}>
              Open Settings →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

/** A terse tag on each row (color carries urgency; text carries it for SR). */
const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  urgent: 'Now',
  warn: 'Soon',
  info: 'FYI',
}

/**
 * "Heads up" — the proactive-insights panel at the top of the message area.
 * Purely local: it renders the ranked, token-free `Insight[]` as rows (severity
 * tag + title + detail), each with an "Ask about this" (→ agent) + a dismiss.
 * Token-driven: reuses `.tap-card` + the `.mini-alert` severity tints.
 */
function HeadsUp({
  insights,
  onAsk,
  onDismiss,
}: {
  insights: Insight[]
  onAsk: (insight: Insight) => void
  onDismiss?: (id: string) => void
}) {
  const top = maxSeverity(insights)
  return (
    <section className="companion-headsup" aria-label="Proactive brewing insights">
      <div className="companion-headsup-head">
        <span className="companion-headsup-title">Heads up</span>
        <span className={`mini-alert ${top ? severityTint(top) : 'info'}`} aria-hidden="true">
          {insights.length}
        </span>
      </div>
      <ul className="companion-headsup-list">
        {insights.map((insight) => (
          <li key={insight.id} className="companion-insight tap-card">
            <span className={`mini-alert ${severityTint(insight.severity)} companion-insight-sev`}>
              {SEVERITY_LABEL[insight.severity]}
            </span>
            <div className="companion-insight-body">
              <p className="companion-insight-title">{insight.title}</p>
              <p className="companion-insight-detail">{insight.detail}</p>
              <div className="companion-insight-actions">
                <button
                  type="button"
                  className="btn-ghost companion-insight-ask"
                  aria-label={`Ask about this — ${insight.title}`}
                  onClick={() => onAsk(insight)}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  Ask about this
                </button>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn companion-insight-dismiss"
              aria-label={`Dismiss insight — ${insight.title}`}
              onClick={() => onDismiss?.(insight.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One rendered turn: a user/assistant/error bubble + tool chips + action cards. */
function Turn({
  turn,
  apply,
}: {
  turn: DisplayTurn
  apply: (action: ActionDescriptor) => Promise<ApplyResult>
}) {
  if (turn.role === 'error') {
    return (
      <div className="companion-msg error" role="alert">
        <span className="companion-error-icon" aria-hidden="true">
          <CircleAlert size={15} />
        </span>
        <div>
          <strong className="companion-error-title">Something went wrong.</strong>
          <p className="companion-error-body">{turn.content}</p>
        </div>
      </div>
    )
  }

  if (turn.role === 'user') {
    return <div className="companion-msg user">{turn.content}</div>
  }

  // Proposals ride in the same toolTrace (a propose tool's result is
  // {kind:'proposal', action}). Pull them out for cards; keep their trace entries
  // OUT of the chip row so a proposal isn't double-represented — a FAILED propose
  // stays in the trace, so it still shows as a normal (failed) chip.
  const proposals = extractProposals(turn.toolTrace)
  const proposalIds = new Set(proposals.map((p) => p.toolCallId))
  const chips = toolChips(turn.toolTrace?.filter((e) => !proposalIds.has(e.toolCallId)))
  return (
    <div className="companion-msg assistant">
      {turn.content.trim() !== '' ? (
        <Markdown>{turn.content}</Markdown>
      ) : (
        <p className="companion-md-p companion-muted">(no reply text)</p>
      )}
      {chips.length > 0 && (
        <ul className="chip-row companion-chips" aria-label="Tools the companion used">
          {chips.map((chip) => (
            <li key={chip.key} className={`companion-chip ${chip.ok ? '' : 'is-fail'}`}>
              <Wrench size={11} aria-hidden="true" />
              {chip.label}
            </li>
          ))}
        </ul>
      )}
      {proposals.length > 0 && (
        <div className="companion-proposals">
          {proposals.map((p) => (
            <ActionCard key={p.toolCallId} action={p.action} apply={apply} />
          ))}
        </div>
      )}
    </div>
  )
}
