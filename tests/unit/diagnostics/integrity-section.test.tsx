// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntegritySection } from '@/components/diagnostics/integrity-section'
import { autoFixLedger, runDataDoctor } from '@/lib/db/doctor'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/db/doctor', () => ({ runDataDoctor: vi.fn(), autoFixLedger: vi.fn() }))

const mockRun = vi.mocked(runDataDoctor)
const mockFix = vi.mocked(autoFixLedger)

// resetAllMocks (not clearAllMocks): clears BOTH call history AND implementations,
// so a base `mockResolvedValue` set in one test cannot leak its default into the
// next (clearAllMocks would leave the implementation in place — an isolation trap).
afterEach(() => vi.resetAllMocks())

describe('IntegritySection', () => {
  it('does NOT run the doctor on mount (expensive — on demand only)', () => {
    render(<IntegritySection />)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs the doctor on click and renders passed chip + failed rows', async () => {
    mockRun.mockResolvedValue({
      passed: 6,
      failed: 1,
      checks: [
        {
          id: 'C1',
          label: 'Inventory ledger balances',
          ok: false,
          severity: 'error',
          count: 2,
          message: 'Cached inventory amount drifted from the sum of its ledger transactions.',
          sampleIds: ['item-a', 'item-b'],
          canAutoFix: true,
        },
      ],
    })
    render(<IntegritySection />)
    expect(mockRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /run integrity check/i }))

    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('diag-integrity-passed')).toHaveTextContent('6 passed')
    const c1 = screen.getByTestId('diag-check-C1')
    expect(c1).toHaveTextContent('Inventory ledger balances')
    expect(c1).toHaveTextContent('item-a')
    expect(screen.getByRole('button', { name: /^fix$/i })).toBeInTheDocument()
  })

  it('[Fix] calls autoFixLedger then re-runs the doctor', async () => {
    mockRun
      .mockResolvedValueOnce({
        passed: 6,
        failed: 1,
        checks: [
          {
            id: 'C1',
            label: 'Inventory ledger balances',
            ok: false,
            severity: 'error',
            count: 1,
            message: 'drifted',
            sampleIds: ['item-a'],
            canAutoFix: true,
          },
        ],
      })
      .mockResolvedValueOnce({ passed: 7, failed: 0, checks: [] })
    mockFix.mockResolvedValue(1)

    render(<IntegritySection />)
    fireEvent.click(screen.getByRole('button', { name: /run integrity check/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^fix$/i }))

    await waitFor(() => expect(mockFix).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('diag-integrity-passed')).toHaveTextContent('7 passed')
  })
})
