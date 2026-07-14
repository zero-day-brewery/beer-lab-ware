// tests/unit/components/install-pwa-card.test.tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallPwaCard } from '@/components/durability/install-pwa-card'

const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

describe('InstallPwaCard', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('renders the Safari "Add to Dock" copy once engaged (manual-safari)', async () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA, standalone: false })
    localStorage.setItem('beer-lab-ware-session-count', '2') // engagement gate satisfied
    render(<InstallPwaCard />)
    await waitFor(() => expect(screen.getByTestId('install-pwa-card')).toBeInTheDocument())
    expect(screen.getByText(/Add to Dock/i)).toBeInTheDocument()
  })

  it('stays hidden before the engagement gate (1st session)', async () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA, standalone: false })
    localStorage.setItem('beer-lab-ware-session-count', '1')
    render(<InstallPwaCard />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('install-pwa-card')).toBeNull()
  })

  it('stays hidden during the ~30-day dismiss cooldown', async () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA, standalone: false })
    localStorage.setItem('beer-lab-ware-session-count', '2')
    localStorage.setItem('beer-lab-ware-install-dismissed', String(Date.now()))
    render(<InstallPwaCard />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('install-pwa-card')).toBeNull()
  })

  it('dismiss hides the card and records the cooldown timestamp', async () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA, standalone: false })
    localStorage.setItem('beer-lab-ware-session-count', '2')
    render(<InstallPwaCard />)
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    fireEvent.click(dismiss)
    await waitFor(() => expect(screen.queryByTestId('install-pwa-card')).toBeNull())
    expect(localStorage.getItem('beer-lab-ware-install-dismissed')).not.toBeNull()
  })

  // LAST — dispatches a real beforeinstallprompt (leaves module-level stashedPrompt set).
  it('shows the Install button after a beforeinstallprompt is captured', async () => {
    vi.stubGlobal('navigator', { userAgent: CHROME_UA, standalone: false })
    localStorage.setItem('beer-lab-ware-session-count', '2')
    render(<InstallPwaCard />)
    const evt = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string }>
    }
    evt.prompt = vi.fn(async () => {})
    Object.defineProperty(evt, 'userChoice', { value: Promise.resolve({ outcome: 'accepted' }) })
    await act(async () => {
      window.dispatchEvent(evt)
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument(),
    )
  })
})
