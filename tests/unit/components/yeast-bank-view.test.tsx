// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YeastBankView } from '@/components/yeast/yeast-bank-view'
import { db } from '@/lib/db/schema'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
describe('YeastBankView', () => {
  beforeEach(async () => {
    await db.yeastLots.clear()
  })
  it('shows the YeastEmptyScene when there are no lots', async () => {
    render(<YeastBankView />)
    expect(await screen.findByText(/no yeast lots|waiting to bud|add/i)).toBeInTheDocument()
    expect(document.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
})
