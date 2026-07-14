// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DurabilityInit } from '@/components/shell/durability-init'
import { db } from '@/lib/db/schema'

describe('DurabilityInit', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(async () => {
    await db.appMeta.clear()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('mounts, renders nothing, advances the session counter, and the boot effect does not throw', async () => {
    const { container } = render(<DurabilityInit />)
    expect(container).toBeEmptyDOMElement()
    expect(localStorage.getItem('beer-lab-ware-session-count')).toBe('1') // recordSession() ran on mount
    await new Promise((r) => setTimeout(r, 0)) // let persist/estimate/staleness settle (nudge, swallowed)
  })
})
