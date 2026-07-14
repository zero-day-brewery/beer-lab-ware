// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EquipmentEditView } from '@/components/equipment/equipment-edit-view'
import { db } from '@/lib/db/schema'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => ({ get: () => null }),
}))

describe('EquipmentEditView (new)', () => {
  beforeEach(async () => {
    await db.equipmentProfiles.clear()
  })
  afterEach(async () => {
    await db.equipmentProfiles.clear()
  })

  it('renders core fields', async () => {
    render(<EquipmentEditView mode="new" />)
    expect(await screen.findByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/kettle volume/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/brewhouse efficiency/i)).toBeInTheDocument()
  })

  it('saves a valid profile', async () => {
    const user = userEvent.setup()
    render(<EquipmentEditView mode="new" />)
    await user.clear(screen.getByLabelText(/^name$/i))
    await user.type(screen.getByLabelText(/^name$/i), 'My B40')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await new Promise((r) => setTimeout(r, 200))
    const all = await db.equipmentProfiles.toArray()
    expect(all.find((p) => p.name === 'My B40')).toBeDefined()
  })
})
