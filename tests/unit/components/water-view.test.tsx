// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Water } from '@/lib/brewing/types/ingredient'

const burton: Water = {
  id: '7a7e0001-0000-4000-8000-0000000000aa',
  kind: 'water',
  name: 'Burton-on-Trent',
  Ca_ppm: 275,
  Mg_ppm: 40,
  Na_ppm: 25,
  SO4_ppm: 610,
  Cl_ppm: 35,
  HCO3_ppm: 270,
}

// All values referenced in vi.mock factories must come from vi.hoisted().
const h = vi.hoisted(() => ({
  profiles: [] as Water[],
  isLoading: false,
  save: vi.fn(async (w: Water) => w),
  del: vi.fn(async (_id: string) => {}),
}))

vi.mock('@/stores/water-profiles-store', () => ({
  useWaterProfilesStore: () => ({ profiles: h.profiles, isLoading: h.isLoading }),
}))
vi.mock('@/lib/db/repos/water', () => ({
  waterRepo: { save: (w: Water) => h.save(w), delete: (id: string) => h.del(id) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { WaterView } from '@/components/water/water-view'

afterEach(() => {
  vi.clearAllMocks()
  h.profiles = []
  h.isLoading = false
})

describe('WaterView', () => {
  it('shows the empty state when no profiles exist', () => {
    render(<WaterView />)
    expect(screen.getByText(/no water profiles — add your source water/i)).toBeInTheDocument()
  })

  it('renders a comparison row per profile with ion bars, SO₄:Cl ratio and balance label', () => {
    h.profiles = [burton]
    const { container } = render(<WaterView />)
    expect(screen.getByText('Burton-on-Trent')).toBeInTheDocument()
    // 610 / 35 ≈ 17.4 → ratio + balance label are separate cells now.
    expect(screen.getByText(/17\.43 : 1/)).toBeInTheDocument()
    expect(screen.getByText(/aggressively dry \/ hoppy/i)).toBeInTheDocument()
    // Raw ppm still shown alongside each mini-bar.
    expect(screen.getByText('610')).toBeInTheDocument()
    // Six ion mini-bars, each with a width-scaled fill.
    const fills = container.querySelectorAll('.wc-bar .fill')
    expect(fills).toHaveLength(6)
  })

  it('scales each ion bar against the SHARED per-ion max across profiles', () => {
    // Burton owns the SO₄ max (610) → full bar; the soft profile (25) is a sliver.
    const soft: Water = {
      id: '7a7e0001-0000-4000-8000-0000000000bb',
      kind: 'water',
      name: 'Soft',
      Ca_ppm: 25,
      Mg_ppm: 5,
      Na_ppm: 10,
      SO4_ppm: 25,
      Cl_ppm: 20,
      HCO3_ppm: 30,
    }
    h.profiles = [burton, soft]
    render(<WaterView />)
    const so4Bars = screen.getAllByTestId('bar-SO4_ppm')
    expect(so4Bars).toHaveLength(2)
    // CSSOM normalises '100.0%' → '100%'.
    expect((so4Bars[0] as HTMLElement).style.width).toBe('100%')
    // 25 / 610 ≈ 4.1%
    expect((so4Bars[1] as HTMLElement).style.width).toBe('4.1%')
  })

  it('keeps the KPI strip (profiles / sulfate-fwd / chloride-fwd)', () => {
    h.profiles = [burton]
    render(<WaterView />)
    expect(screen.getByText('Profiles')).toBeInTheDocument()
    expect(screen.getByText('Sulfate-fwd')).toBeInTheDocument()
    expect(screen.getByText('Chloride-fwd')).toBeInTheDocument()
  })

  it('adds a new profile through the inline form', async () => {
    const user = userEvent.setup()
    render(<WaterView />)
    await user.click(screen.getByRole('button', { name: /add water/i }))
    const form = screen.getByRole('button', { name: 'Save' }).closest('form') as HTMLFormElement
    await user.type(within(form).getByPlaceholderText('My tap water'), 'RO Water')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].name).toBe('RO Water')
    expect(h.save.mock.calls[0][0].kind).toBe('water')
  })

  it('edits an existing profile and persists the changed ion', async () => {
    h.profiles = [burton]
    const user = userEvent.setup()
    render(<WaterView />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const clInput = screen.getByRole('spinbutton', { name: 'Cl' })
    await user.clear(clInput)
    await user.type(clInput, '80')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].Cl_ppm).toBe(80)
    expect(h.save.mock.calls[0][0].id).toBe(burton.id)
  })

  it('deletes only after confirmation', async () => {
    h.profiles = [burton]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<WaterView />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(h.del).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(h.del).toHaveBeenCalledWith(burton.id))
    confirmSpy.mockRestore()
  })

  it('shows a loading state while the store hydrates', () => {
    h.isLoading = true
    render(<WaterView />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('exposes resizable column grips whose keyboard resize rewrites the grid template', () => {
    localStorage.clear()
    h.profiles = [burton]
    const { container } = render(<WaterView />)

    // A grip per resizable header column (name + 6 ions + ratio + balance), not actions.
    const handles = screen.getAllByRole('separator', { name: /^Resize / })
    expect(handles).toHaveLength(9)

    const head = container.querySelector('.wc-head') as HTMLElement
    const before = head.style.gridTemplateColumns
    expect(before).toContain('px') // state-driven, not the CSS fallback

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Ca' }), { key: 'ArrowRight' })
    const after = head.style.gridTemplateColumns
    expect(after).not.toBe(before)
    // The row grid tracks the same template as the header.
    const row = container.querySelector('.wc-row') as HTMLElement
    expect(row.style.gridTemplateColumns).toBe(after)
    // Row content is intact.
    expect(screen.getByText('Burton-on-Trent')).toBeInTheDocument()
    localStorage.clear()
  })
})
