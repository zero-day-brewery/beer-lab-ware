// tests/unit/components/durability-section.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DurabilitySection } from '@/components/durability/durability-section'
import { db } from '@/lib/db/schema'

describe('DurabilitySection', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
    localStorage.clear()
  })
  afterEach(async () => {
    await db.appMeta.clear()
    localStorage.clear()
  })

  it('renders the section wrapping badge + backup card without throwing', async () => {
    render(<DurabilitySection />)
    await waitFor(() => expect(screen.getByTestId('durability-section')).toBeInTheDocument())
    expect(screen.getByTestId('durability-badge')).toBeInTheDocument()
    expect(screen.getByTestId('backup-settings-card')).toBeInTheDocument()
  })
})
