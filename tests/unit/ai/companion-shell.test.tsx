// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AppShell } from '@/components/shell/app-shell'
import { ThemeProvider } from '@/components/shell/theme-provider'
import { DEFAULT_COMPANION_SETTINGS } from '@/lib/ai/settings'
import { useCompanionSettingsStore } from '@/stores/companion-settings-store'

function renderShell() {
  return render(
    <ThemeProvider>
      <AppShell>
        <div>page-content</div>
      </AppShell>
    </ThemeProvider>,
  )
}

afterEach(() => {
  useCompanionSettingsStore.setState({ settings: DEFAULT_COMPANION_SETTINGS })
})

describe('AppShell companion trigger', () => {
  it('exposes the companion trigger on the page', () => {
    renderShell()
    expect(screen.getByRole('button', { name: /open brewing companion/i })).toBeInTheDocument()
    // Drawer starts closed.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the drawer from the trigger and closes it again', async () => {
    renderShell()
    const trigger = screen.getByRole('button', { name: /open brewing companion/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: /brewing companion/i })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Exact name → the header close button, not the backdrop ("Dismiss companion").
    await userEvent.click(screen.getByRole('button', { name: 'Close companion' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does not regress the primary nav links', async () => {
    renderShell()
    // Nav intact before… (exact 'Settings' → the nav link, not the drawer's setup link)
    expect(screen.getByRole('link', { name: /recipes/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('link', { name: /water/i })).toHaveAttribute('href', '/water')

    // …and still intact after opening the companion.
    await userEvent.click(screen.getByRole('button', { name: /open brewing companion/i }))
    expect(screen.getByRole('link', { name: /recipes/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
})
