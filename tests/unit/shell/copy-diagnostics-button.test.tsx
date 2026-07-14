// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyDiagnosticsButton } from '@/components/shell/copy-diagnostics-button'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('CopyDiagnosticsButton', () => {
  afterEach(() => vi.restoreAllMocks())

  it('copies a JSON diagnostics blob to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CopyDiagnosticsButton />)
    fireEvent.click(screen.getByRole('button', { name: /copy diagnostics/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('"appVersion"')
  })

  it('copies the provided payload when one is passed (full on-screen snapshot)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    // A rich payload carries fields the sync getDiagnostics() blob never has —
    // table counts + a storage estimate — proving the copy is the on-screen snapshot.
    const payload = {
      db: { tables: [{ name: 'recipes', count: 42 }] },
      storage: { estimate: { usageBytes: 900, quotaBytes: 1000, percentUsed: 0.9 } },
    }
    render(<CopyDiagnosticsButton payload={payload} />)
    fireEvent.click(screen.getByRole('button', { name: /copy diagnostics/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain('"recipes"')
    expect(copied).toContain('42')
    expect(copied).toContain('"usageBytes"')
    // NOT the fallback sync blob — the payload replaces it entirely
    expect(copied).not.toContain('"appVersion"')
  })
})
