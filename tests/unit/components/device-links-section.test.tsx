// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceLinksSection } from '@/components/settings/device-links-section'
import type { Batch } from '@/lib/brewing/types/batch'
import { deviceLinksRepo } from '@/lib/db/repos/device-links'
import { db } from '@/lib/db/schema'
import { syncMetaRepo } from '@/lib/sync/sync-meta'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function batch(over: Partial<Batch> & { id: string; batchNo: number; name: string }): Batch {
  return {
    status: 'in-progress',
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

const BATCH_A = { id: '11111111-1111-4111-8111-111111111111', batchNo: 1, name: 'Hazy IPA' }
const BATCH_B = { id: '22222222-2222-4222-8222-222222222222', batchNo: 2, name: 'Dry Stout' }
const BATCH_DONE = { id: '33333333-3333-4333-8333-333333333333', batchNo: 3, name: 'Old Saison' }

describe('DeviceLinksSection (Settings → Sensor devices)', () => {
  beforeEach(async () => {
    await db.open()
    await db.deviceLinks.clear()
    await db.batches.clear()
    await db.appMeta.clear()
    await db.batches.put(batch(BATCH_A))
    await db.batches.put(batch(BATCH_B))
  })
  afterEach(async () => {
    await db.deviceLinks.clear()
    await db.batches.clear()
    await db.appMeta.clear()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('renders the add-link form and the how-to hint with a placeholder endpoint when no server is configured', async () => {
    render(<DeviceLinksSection />)
    expect(await screen.findByLabelText('Device key')).toBeInTheDocument()
    expect(screen.getByLabelText('Batch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link device' })).toBeInTheDocument()
    expect(screen.getByTestId('device-links-howto')).toHaveTextContent(
      '<your sync server>/readings',
    )
  })

  it('shows the real endpoint once a sync server URL is configured', async () => {
    await syncMetaRepo.setServerUrl('https://brewery.example.com')
    render(<DeviceLinksSection />)
    await waitFor(() =>
      expect(screen.getByTestId('device-links-howto')).toHaveTextContent(
        'https://brewery.example.com/readings',
      ),
    )
  })

  it('shows "No devices linked yet" with an empty list', async () => {
    render(<DeviceLinksSection />)
    expect(await screen.findByText('No devices linked yet.')).toBeInTheDocument()
  })

  it('lists existing links with their batch selected', async () => {
    await deviceLinksRepo.assign('tilt:RED', BATCH_A.id)
    render(<DeviceLinksSection />)
    const row = await screen.findByTestId('device-link-tilt:RED')
    expect(row).toHaveTextContent('tilt:RED')
    expect(screen.getByLabelText('Batch for tilt:RED')).toHaveValue(BATCH_A.id)
  })

  it('adding a new link via the form calls deviceLinksRepo.assign and clears the form', async () => {
    render(<DeviceLinksSection />)
    fireEvent.change(await screen.findByLabelText('Device key'), {
      target: { value: 'ispindel:iSpindel001' },
    })
    // Wait for the batches liveQuery to populate the <select>'s options
    // before choosing one — jsdom silently no-ops a value assignment against
    // an option that doesn't exist yet.
    await screen.findByRole('option', { name: /Dry Stout/ })
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: BATCH_B.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Link device' }))

    await waitFor(async () => {
      const link = await deviceLinksRepo.getByDeviceKey('ispindel:iSpindel001')
      expect(link?.batchId).toBe(BATCH_B.id)
    })
    await waitFor(() => expect(screen.getByLabelText('Device key')).toHaveValue(''))

    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalled()
  })

  it('rejects submitting with no device key or no batch selected', async () => {
    render(<DeviceLinksSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link device' }))
    const { toast } = await import('sonner')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(await deviceLinksRepo.list()).toHaveLength(0)
  })

  it("changing a link's batch selector reassigns it in place (same deviceKey, new batchId)", async () => {
    const original = await deviceLinksRepo.assign('tilt:RED', BATCH_A.id)
    render(<DeviceLinksSection />)
    const select = await screen.findByLabelText('Batch for tilt:RED')
    fireEvent.change(select, { target: { value: BATCH_B.id } })

    await waitFor(async () => {
      const reassigned = await deviceLinksRepo.get(original.id)
      expect(reassigned?.batchId).toBe(BATCH_B.id)
    })
    // Still exactly one link for this device — a reassign, not a duplicate.
    expect(await deviceLinksRepo.list()).toHaveLength(1)
  })

  it('Unlink removes the device link (and tombstones it, via the repo)', async () => {
    await deviceLinksRepo.assign('tilt:RED', BATCH_A.id)
    render(<DeviceLinksSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink tilt:RED' }))

    await waitFor(async () => expect(await deviceLinksRepo.list()).toHaveLength(0))
    expect(screen.getByText('No devices linked yet.')).toBeInTheDocument()
  })

  it('a link whose batch was deleted still renders (shown as "deleted batch"), never crashes', async () => {
    await deviceLinksRepo.assign('tilt:RED', 'ghost-batch-id')
    render(<DeviceLinksSection />)
    const select = await screen.findByLabelText('Batch for tilt:RED')
    expect(select).toHaveValue('ghost-batch-id')
    expect(screen.getByText('deleted batch')).toBeInTheDocument()
  })

  // ── C1: device-key normalization on save ──────────────────────────────────

  it('normalizes a hand-typed tilt key on save: trim + collapse whitespace, lowercase prefix, UPPERCASE color', async () => {
    render(<DeviceLinksSection />)
    fireEvent.change(await screen.findByLabelText('Device key'), {
      target: { value: '  Tilt : red  ' },
    })
    await screen.findByRole('option', { name: /Dry Stout/ })
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: BATCH_B.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Link device' }))

    await waitFor(async () => {
      const link = await deviceLinksRepo.getByDeviceKey('tilt:RED')
      expect(link?.batchId).toBe(BATCH_B.id)
    })
    // The daemon could never derive the raw variant — only the normalized key
    // may be stored, or the link silently never matches an ingest.
    expect(await deviceLinksRepo.list()).toHaveLength(1)
  })

  it('lowercases the provider prefix but PRESERVES identity case for ispindel keys (names are case-sensitive)', async () => {
    render(<DeviceLinksSection />)
    fireEvent.change(await screen.findByLabelText('Device key'), {
      target: { value: 'ISpindel:iSpindel001' },
    })
    await screen.findByRole('option', { name: /Hazy IPA/ })
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: BATCH_A.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Link device' }))

    await waitFor(async () => {
      const link = await deviceLinksRepo.getByDeviceKey('ispindel:iSpindel001')
      expect(link?.batchId).toBe(BATCH_A.id)
    })
  })

  it("rejects a key with no ':' separator inline, naming the provider:identity form, and stores nothing", async () => {
    render(<DeviceLinksSection />)
    fireEvent.change(await screen.findByLabelText('Device key'), { target: { value: 'tiltred' } })
    await screen.findByRole('option', { name: /Hazy IPA/ })
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: BATCH_A.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Link device' }))

    const error = await screen.findByTestId('device-key-error')
    expect(error).toHaveTextContent('provider:identity')
    expect(await deviceLinksRepo.list()).toHaveLength(0)
    // The rejected value stays in the field for correction…
    expect(screen.getByLabelText('Device key')).toHaveValue('tiltred')
    // …and the message clears as soon as the user edits it.
    fireEvent.change(screen.getByLabelText('Device key'), { target: { value: 'tilt:red' } })
    expect(screen.queryByTestId('device-key-error')).not.toBeInTheDocument()
  })

  it('shows a persistent hint that non-tilt identities must match the ingest-reported key exactly', async () => {
    render(<DeviceLinksSection />)
    expect(await screen.findByTestId('device-key-hint')).toHaveTextContent(
      'exactly as an unlinked-ingest response reports it',
    )
  })

  // ── C2: batch selector status labeling + ordering ─────────────────────────

  it('suffixes non-in-progress batches with their status and sorts in-progress batches first', async () => {
    // Distinct updatedAt so newest-first repo order is deterministic — and the
    // COMPLETE batch is newest, so without the status sort it would list FIRST.
    await db.batches.put(batch({ ...BATCH_A, updatedAt: '2026-07-02T00:00:00.000Z' }))
    await db.batches.put(
      batch({ ...BATCH_DONE, status: 'complete', updatedAt: '2026-07-10T00:00:00.000Z' }),
    )
    render(<DeviceLinksSection />)
    await screen.findByRole('option', { name: '#3 · Old Saison (complete)' })
    const labels = within(screen.getByLabelText('Batch'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(labels).toEqual([
      'Select a batch…',
      '#1 · Hazy IPA',
      '#2 · Dry Stout',
      '#3 · Old Saison (complete)',
    ])
  })

  it("a link row's reassign selector carries the same status labels", async () => {
    await db.batches.put(
      batch({ ...BATCH_DONE, status: 'archived', updatedAt: '2026-07-10T00:00:00.000Z' }),
    )
    await deviceLinksRepo.assign('tilt:RED', BATCH_A.id)
    render(<DeviceLinksSection />)
    const select = await screen.findByLabelText('Batch for tilt:RED')
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(labels[labels.length - 1]).toBe('#3 · Old Saison (archived)')
  })

  it('linking a device to a completed batch is still ALLOWED (late lab readings are legitimate)', async () => {
    await db.batches.put(
      batch({ ...BATCH_DONE, status: 'complete', updatedAt: '2026-07-10T00:00:00.000Z' }),
    )
    render(<DeviceLinksSection />)
    fireEvent.change(await screen.findByLabelText('Device key'), { target: { value: 'tilt:RED' } })
    await screen.findByRole('option', { name: '#3 · Old Saison (complete)' })
    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: BATCH_DONE.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Link device' }))

    await waitFor(async () => {
      const link = await deviceLinksRepo.getByDeviceKey('tilt:RED')
      expect(link?.batchId).toBe(BATCH_DONE.id)
    })
  })

  // ── C3: endpoint hint tracks the live server URL ──────────────────────────

  it('endpoint hint tracks edits to the sync server URL made AFTER mount (no stale read-once)', async () => {
    await syncMetaRepo.setServerUrl('https://old.example.com')
    render(<DeviceLinksSection />)
    await waitFor(() =>
      expect(screen.getByTestId('device-links-howto')).toHaveTextContent(
        'https://old.example.com/readings',
      ),
    )
    // SyncSection persists on each valid keystroke — simulate its write.
    await syncMetaRepo.setServerUrl('https://new.example.com')
    await waitFor(() =>
      expect(screen.getByTestId('device-links-howto')).toHaveTextContent(
        'https://new.example.com/readings',
      ),
    )
  })
})
