// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as useInsightsModule from '@/components/ai/use-insights'
import { AppShell } from '@/components/shell/app-shell'
import { ThemeProvider } from '@/components/shell/theme-provider'
import { DEFAULT_COMPANION_SETTINGS } from '@/lib/ai/settings'
import type { Insight, InsightSeverity } from '@/lib/brewing/insights/types'
import { useCompanionSettingsStore } from '@/stores/companion-settings-store'

const insight = (severity: InsightSeverity, id: string): Insight => ({
  id,
  kind: 'low_stock',
  severity,
  title: `t-${id}`,
  detail: `d-${id}`,
})

/** Stub the hook (keep the real maxSeverity/severityTint) so we can feed insights. */
function mockInsights(insights: Insight[]) {
  vi.spyOn(useInsightsModule, 'useInsights').mockReturnValue({ insights, dismiss: vi.fn() })
}

function renderShell() {
  return render(
    <ThemeProvider>
      <AppShell>
        <div>page-content</div>
      </AppShell>
    </ThemeProvider>,
  )
}

function fab() {
  return screen.getByRole('button', { name: /open brewing companion/i })
}

afterEach(() => {
  vi.restoreAllMocks()
  useCompanionSettingsStore.setState({ settings: DEFAULT_COMPANION_SETTINGS })
})

describe('AppShell — companion FAB insight badge', () => {
  it('shows a count badge tinted by the MAX severity when insights > 0', () => {
    mockInsights([insight('info', 'a'), insight('urgent', 'b'), insight('warn', 'c')])
    renderShell()

    const badge = fab().querySelector('.companion-fab-badge')
    expect(badge).not.toBeNull()
    expect(badge).toHaveTextContent('3')
    // urgent is the max → the `.mini-alert.warn` (ember-red) tint.
    expect(badge).toHaveClass('mini-alert', 'warn')
  })

  it('reflects the count in the accessible name', () => {
    mockInsights([insight('warn', 'a'), insight('warn', 'b')])
    renderShell()
    expect(fab()).toHaveAccessibleName('Open brewing companion — 2 heads-up')
    // max = warn → malt-amber `info` tint.
    expect(fab().querySelector('.companion-fab-badge')).toHaveClass('mini-alert', 'info')
  })

  it('an all-info set tints the badge hop-green (go)', () => {
    mockInsights([insight('info', 'a')])
    renderShell()
    expect(fab().querySelector('.companion-fab-badge')).toHaveClass('mini-alert', 'go')
  })

  it('shows NO badge and a plain label when there are no insights', () => {
    mockInsights([])
    renderShell()
    expect(fab()).toHaveAccessibleName('Open brewing companion')
    expect(fab().querySelector('.companion-fab-badge')).toBeNull()
  })
})
