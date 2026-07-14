// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsView } from '@/components/settings/settings-view'
import { ThemeProvider } from '@/components/shell/theme-provider'
import { db } from '@/lib/db/schema'

function renderView() {
  return render(
    <ThemeProvider>
      <SettingsView />
    </ThemeProvider>,
  )
}

describe('SettingsView', () => {
  beforeEach(async () => {
    await db.settings.clear()
    await db.equipmentProfiles.clear()
    localStorage.clear()
  })
  afterEach(async () => {
    await db.settings.clear()
    await db.equipmentProfiles.clear()
  })

  it('renders units, theme, and default equipment controls', async () => {
    renderView()
    expect(await screen.findByLabelText(/units/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument()
    expect(screen.getByText(/default equipment/i)).toBeInTheDocument()
  })

  it('saves units to settings repo when changed', async () => {
    const user = userEvent.setup()
    renderView()
    const unitsSel = await screen.findByLabelText(/units/i)
    await user.selectOptions(unitsSel, 'imperial')
    await new Promise((r) => setTimeout(r, 150))
    const s = await db.settings.get('global')
    expect(s?.units).toBe('imperial')
  })
})
