// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionDrawer } from '@/components/ai/companion-drawer'
import { FakeProvider, finalText, toolUse } from '@/lib/ai/__fixtures__/fake-provider'
import type { ApplyResult } from '@/lib/ai/actions/apply'
import type { ScaleRecipeAction } from '@/lib/ai/actions/types'
import { DEFAULT_COMPANION_SETTINGS } from '@/lib/ai/settings'
import * as toolsModule from '@/lib/ai/tools'
import type { AiTool, ChatProvider, CompleteResponse } from '@/lib/ai/types'
import { useCompanionSettingsStore } from '@/stores/companion-settings-store'

// A toy read-only registry — no Zod, no Dexie — so the loop can run headlessly.
const listInventory: AiTool = {
  name: 'list_inventory',
  description: 'list inventory',
  inputSchema: { type: 'object' },
  run: async () => [{ name: 'Citra', amount: 2 }],
}
const calcRecipe: AiTool = {
  name: 'calc_recipe',
  description: 'calc recipe',
  inputSchema: { type: 'object' },
  run: async () => ({ recipeName: 'West Coast IPA', computed: { IBU: 64 } }),
}
const toyTools = [listInventory, calcRecipe]

const VALID_CONFIG = {
  provider: 'anthropic' as const,
  apiKey: 'sk-test',
  model: 'claude-test',
  schemaVersion: 1 as const,
}

function setConfig(usable: boolean) {
  useCompanionSettingsStore.setState({
    settings: usable ? VALID_CONFIG : DEFAULT_COMPANION_SETTINGS,
  })
}

/** providerFactory that always returns the given provider. */
const factoryOf = (p: ChatProvider) => () => p

afterEach(() => {
  vi.restoreAllMocks()
  useCompanionSettingsStore.setState({ settings: DEFAULT_COMPANION_SETTINGS })
})

describe('CompanionDrawer', () => {
  it('renders nothing when closed', () => {
    setConfig(true)
    const { container } = render(<CompanionDrawer open={false} onClose={vi.fn()} />)
    expect(container.querySelector('.companion-drawer')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('NO-CONFIG: shows the Settings setup prompt and no input', () => {
    setConfig(false) // default settings = Anthropic with no key → not usable
    render(<CompanionDrawer open onClose={vi.fn()} tools={toyTools} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/set up your ai first/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /open settings/i })
    expect(link).toHaveAttribute('href', '/settings')
    // The composer must NOT be present in the no-config state.
    expect(screen.queryByLabelText(/message the brewing companion/i)).toBeNull()
  })

  it('Esc closes the drawer', async () => {
    setConfig(true)
    const onClose = vi.fn()
    render(<CompanionDrawer open onClose={onClose} tools={toyTools} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends a message → runs the agent → renders assistant markdown + tool chips', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([{ id: 't1', name: 'list_inventory', args: {} }]),
      finalText('You have **2 kg** of Citra left.'),
    ])
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
      />,
    )

    const box = screen.getByLabelText(/message the brewing companion/i)
    await userEvent.type(box, 'what hops do I have?{Enter}')

    // Assistant markdown: the bold key number is rendered as <strong>.
    const strong = await screen.findByText('2 kg')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.getByText(/of Citra left/)).toBeInTheDocument()

    // Tool chip derived from the run's toolTrace.
    expect(screen.getByText('read your inventory')).toBeInTheDocument()

    // The provider actually saw our grounding system prompt + the user turn.
    // (Assert by `.some` — runAgent mutates the shared messages array in place,
    // so the recorded reference gains tool turns after the first call.)
    expect(provider.calls[0].system).toMatch(/never guess/i)
    expect(
      provider.calls[0].messages.some(
        (m) => m.role === 'user' && m.content === 'what hops do I have?',
      ),
    ).toBe(true)

    // Composer clears + re-enables after the turn.
    await waitFor(() => expect(box).toHaveValue(''))
    expect(box).not.toBeDisabled()
  })

  it('labels a calc chip with the recipe name from the tool args', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([{ id: 'c1', name: 'calc_recipe', args: { recipe: { name: 'West Coast IPA' } } }]),
      finalText('Comes out to 64 IBU.'),
    ])
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
      />,
    )

    await userEvent.type(
      screen.getByLabelText(/message the brewing companion/i),
      'scale my IPA{Enter}',
    )
    expect(await screen.findByText('calculated West Coast IPA')).toBeInTheDocument()
  })

  it('a provider error renders an error bubble and never crashes', async () => {
    setConfig(true)
    const boom: ChatProvider = {
      complete: vi.fn().mockRejectedValue(new Error('missing api key')),
    }
    render(
      <CompanionDrawer open onClose={vi.fn()} providerFactory={factoryOf(boom)} tools={toyTools} />,
    )

    await userEvent.type(screen.getByLabelText(/message the brewing companion/i), 'hello{Enter}')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/missing api key/i)).toBeInTheDocument()
    // The drawer is still alive: the composer is back and usable.
    expect(screen.getByLabelText(/message the brewing companion/i)).not.toBeDisabled()
  })

  it('Enter sends, Shift+Enter inserts a newline (does not send)', async () => {
    setConfig(true)
    const provider = new FakeProvider([finalText('ok')])
    const spy = vi.spyOn(provider, 'complete')
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
      />,
    )

    const box = screen.getByLabelText(/message the brewing companion/i)
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(spy).not.toHaveBeenCalled()
    expect((box as HTMLTextAreaElement).value).toContain('\n')

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('disables the input while the agent is thinking', async () => {
    setConfig(true)
    let resolve!: (r: CompleteResponse) => void
    const pending = new Promise<CompleteResponse>((r) => {
      resolve = r
    })
    const provider: ChatProvider = { complete: () => pending }
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={toyTools}
      />,
    )

    const box = screen.getByLabelText(/message the brewing companion/i)
    await userEvent.type(box, 'slow question{Enter}')

    // In flight → the composer is disabled and the thinking indicator shows.
    await waitFor(() => expect(box).toBeDisabled())
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Resolve the round-trip → composer re-enables.
    await act(async () => {
      resolve(finalText('done'))
      await pending
    })
    await waitFor(() => expect(box).not.toBeDisabled())
  })
})

// ── Companion v2 Stage B: propose → Approve/Discard action cards ──────────────

const scaleAction: ScaleRecipeAction = {
  type: 'scale_recipe',
  title: 'Scale "West Coast IPA" → 40 L',
  preview: {
    recipeName: 'West Coast IPA',
    before: { batchSize_L: 20, OG: 1.062 },
    after: { batchSize_L: 40, OG: 1.062 },
  },
  payload: { name: 'West Coast IPA (scaled)' } as ScaleRecipeAction['payload'],
}

// A toy PROPOSE tool: its result is a proposal (never a write) — exactly the
// shape a real propose_* tool returns, riding in the run's toolTrace.
const proposeScale: AiTool = {
  name: 'propose_scale_recipe',
  description: 'propose a recipe scale',
  inputSchema: { type: 'object' },
  run: async () => ({ kind: 'proposal', action: scaleAction }),
}
const proposeTools = [proposeScale, ...toyTools]

const okRecipe: ApplyResult = {
  ok: true,
  result: { kind: 'recipe', recipe: { name: 'West Coast IPA (scaled)' } as never },
}

describe('CompanionDrawer v2 — proposed action cards', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useCompanionSettingsStore.setState({ settings: DEFAULT_COMPANION_SETTINGS })
  })

  it('builds its registry from buildAllTools (write tools are proposable in v2)', () => {
    setConfig(true)
    const spy = vi.spyOn(toolsModule, 'buildAllTools').mockReturnValue(toyTools)
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(new FakeProvider([finalText('hi')]))}
      />,
    )
    expect(spy).toHaveBeenCalled()
  })

  it('a propose tool result renders an action card with a TRUTHFUL preview; nothing writes on render', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([
        { id: 's1', name: 'propose_scale_recipe', args: { recipeId: 'x', targetBatchSize_L: 40 } },
      ]),
      finalText("I've drafted a 40 L scale — approve the card to save it, or discard it."),
    ])
    const apply = vi.fn(async () => okRecipe)
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={proposeTools}
        apply={apply}
      />,
    )

    await userEvent.type(
      screen.getByLabelText(/message the brewing companion/i),
      'scale my IPA to 40 L{Enter}',
    )

    // The card shows the proposal's own numbers — before→after, not a hallucination.
    expect(await screen.findByText('Scale "West Coast IPA" → 40 L')).toBeInTheDocument()
    expect(screen.getByText('West Coast IPA')).toBeInTheDocument()
    expect(screen.getByText('20 L')).toBeInTheDocument()
    expect(screen.getByText('40 L')).toBeInTheDocument()
    // The assistant's summary text also renders.
    expect(screen.getByText(/approve the card to save it/i)).toBeInTheDocument()

    // Proposing writes NOTHING — apply is untouched until a human clicks Approve.
    expect(apply).not.toHaveBeenCalled()
  })

  it('Approve on the card calls applyAction ONCE and moves the card to applied', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([{ id: 's1', name: 'propose_scale_recipe', args: {} }]),
      finalText('drafted.'),
    ])
    const apply = vi.fn(async () => okRecipe)
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={proposeTools}
        apply={apply}
      />,
    )

    await userEvent.type(screen.getByLabelText(/message the brewing companion/i), 'scale it{Enter}')
    await screen.findByText('Scale "West Coast IPA" → 40 L')
    expect(apply).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^Approve:/ }))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(scaleAction)
    expect(await screen.findByText('✓ Saved "West Coast IPA (scaled)"')).toBeInTheDocument()
  })

  it('Discard dismisses the proposal WITHOUT calling applyAction', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([{ id: 's1', name: 'propose_scale_recipe', args: {} }]),
      finalText('drafted.'),
    ])
    const apply = vi.fn<() => Promise<ApplyResult>>()
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={proposeTools}
        apply={apply}
      />,
    )

    await userEvent.type(screen.getByLabelText(/message the brewing companion/i), 'scale it{Enter}')
    await screen.findByText('Scale "West Coast IPA" → 40 L')

    await userEvent.click(screen.getByRole('button', { name: /^Discard:/ }))

    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByText(/Discarded/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
  })

  it('v1 read-only chat still works alongside the propose registry', async () => {
    setConfig(true)
    const provider = new FakeProvider([
      toolUse([{ id: 't1', name: 'list_inventory', args: {} }]),
      finalText('You have **2 kg** of Citra left.'),
    ])
    const apply = vi.fn<() => Promise<ApplyResult>>()
    render(
      <CompanionDrawer
        open
        onClose={vi.fn()}
        providerFactory={factoryOf(provider)}
        tools={proposeTools}
        apply={apply}
      />,
    )

    await userEvent.type(
      screen.getByLabelText(/message the brewing companion/i),
      'what hops do I have?{Enter}',
    )

    const strong = await screen.findByText('2 kg')
    expect(strong.tagName).toBe('STRONG')
    // Read chip present, no action card (no Approve control), no write.
    expect(screen.getByText('read your inventory')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve:/ })).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })
})
