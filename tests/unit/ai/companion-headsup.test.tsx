// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionDrawer } from '@/components/ai/companion-drawer'
import { FakeProvider, finalText, toolUse } from '@/lib/ai/__fixtures__/fake-provider'
import { DEFAULT_COMPANION_SETTINGS } from '@/lib/ai/settings'
import type { AiTool, ChatProvider } from '@/lib/ai/types'
import type { Insight } from '@/lib/brewing/insights/types'
import { useCompanionSettingsStore } from '@/stores/companion-settings-store'

// A toy read-only registry so the agent loop runs headlessly (no Dexie).
const listInventory: AiTool = {
  name: 'list_inventory',
  description: 'list inventory',
  inputSchema: { type: 'object' },
  run: async () => [{ name: 'Citra', amount: 0.15 }],
}
const toyTools = [listInventory]

const VALID_CONFIG = {
  provider: 'anthropic' as const,
  apiKey: 'sk-test',
  model: 'claude-test',
  schemaVersion: 1 as const,
}
const factoryOf = (p: ChatProvider) => () => p

function setConfig(usable: boolean) {
  useCompanionSettingsStore.setState({
    settings: usable ? VALID_CONFIG : DEFAULT_COMPANION_SETTINGS,
  })
}

const insight = (over: Partial<Insight> & { id: string }): Insight => ({
  kind: 'low_stock',
  severity: 'warn',
  title: 'Low on Citra',
  detail: '150 g on hand (target 500 g) — restock before your next brew.',
  ask: 'I am low on Citra — how much should I reorder, and what can I substitute?',
  ...over,
})

const URGENT = insight({
  id: 'low_stock:pils',
  severity: 'urgent',
  title: 'Out of Pilsner Malt',
  detail: '0 g on hand — restock before your next brew.',
  ask: 'I am out of Pilsner Malt — how much should I reorder?',
})
const INFO = insight({
  id: 'ready_to_package:b1',
  kind: 'ready_to_package',
  severity: 'info',
  title: 'Stout is ready to cold-crash',
  detail: 'Stable at 1.012 for 2+ days.',
  ask: 'Is my Stout ready to cold-crash?',
})

afterEach(() => {
  vi.restoreAllMocks()
  useCompanionSettingsStore.setState({ settings: DEFAULT_COMPANION_SETTINGS })
})

describe('CompanionDrawer — v3 heads-up panel', () => {
  it('renders a "Heads up" row per insight (title + detail + severity tag)', () => {
    setConfig(true)
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(new FakeProvider([finalText('ok')]))}
        tools={toyTools}
        insights={[URGENT, INFO]}
      />,
    )

    const panel = screen.getByRole('region', { name: /proactive brewing insights/i })
    expect(within(panel).getByText('Out of Pilsner Malt')).toBeInTheDocument()
    expect(within(panel).getByText(/0 g on hand/)).toBeInTheDocument()
    expect(within(panel).getByText('Stout is ready to cold-crash')).toBeInTheDocument()
    // Severity tags: urgent → "Now", info → "FYI".
    expect(within(panel).getByText('Now')).toBeInTheDocument()
    expect(within(panel).getByText('FYI')).toBeInTheDocument()
  })

  it('shows NO panel when there are no insights (empty-state still renders)', () => {
    setConfig(true)
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(new FakeProvider([finalText('ok')]))}
        tools={toyTools}
        insights={[]}
      />,
    )
    expect(screen.queryByRole('region', { name: /proactive brewing insights/i })).toBeNull()
    expect(screen.getByText(/ask about your brewing/i)).toBeInTheDocument()
  })

  it('"Ask about this" seeds insight.ask and runs the agent (reuses the send path)', async () => {
    setConfig(true)
    // tool_use → the agent reads inventory (v1 read tool), then answers.
    const provider = new FakeProvider([
      toolUse([{ id: 't1', name: 'list_inventory', args: {} }]),
      finalText('Reorder ~500 g of Citra; Simcoe subs well in the meantime.'),
    ])
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
        insights={[URGENT]}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /ask about this/i }))

    // The seeded question was sent verbatim as the user turn…
    expect(await screen.findByText(URGENT.ask as string)).toBeInTheDocument()
    // …and the agent actually ran: the read tool fired (chip) + the reply shows.
    expect(await screen.findByText(/reorder ~500 g of citra/i)).toBeInTheDocument()
    expect(screen.getByText('read your inventory')).toBeInTheDocument()
    // The provider saw the insight's grounded question as the user message.
    expect(
      provider.calls[0].messages.some((m) => m.role === 'user' && m.content === URGENT.ask),
    ).toBe(true)
  })

  it('falls back to a title-based question when the insight has no ask', async () => {
    setConfig(true)
    const provider = new FakeProvider([finalText('here you go')])
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
        insights={[insight({ id: 'x', ask: undefined, title: 'Old Cascade hops are old' })]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /ask about this/i }))
    await waitFor(() => expect(provider.calls.length).toBe(1))
    expect(
      provider.calls[0].messages.some(
        (m) => m.role === 'user' && /old cascade hops are old/i.test(String(m.content)),
      ),
    ).toBe(true)
  })

  it('dismiss (x) removes that row', async () => {
    setConfig(true)
    function Harness() {
      const [ins, setIns] = useState<Insight[]>([URGENT, INFO])
      return (
        <CompanionDrawer
          open
          onClose={vi.fn()}
          providerFactory={factoryOf(new FakeProvider([finalText('ok')]))}
          tools={toyTools}
          insights={ins}
          onDismiss={(id) => setIns((p) => p.filter((i) => i.id !== id))}
        />
      )
    }
    render(<Harness />)

    expect(screen.getByText('Out of Pilsner Malt')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /dismiss insight — out of pilsner malt/i }),
    )
    await waitFor(() => expect(screen.queryByText('Out of Pilsner Malt')).toBeNull())
    // The other insight survives.
    expect(screen.getByText('Stout is ready to cold-crash')).toBeInTheDocument()
  })

  it('v1 typed chat still works with the panel present (no regression)', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([{ id: 't1', name: 'list_inventory', args: {} }]),
      finalText('You have **150 g** of Citra.'),
    ])
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
        insights={[URGENT]}
      />,
    )

    await userEvent.type(
      screen.getByLabelText(/message the brewing companion/i),
      'what hops do I have?{Enter}',
    )
    const strong = await screen.findByText('150 g')
    expect(strong.tagName).toBe('STRONG')
    // The panel is still there alongside the conversation.
    expect(screen.getByRole('region', { name: /proactive brewing insights/i })).toBeInTheDocument()
  })
})
