'use client'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import type { YeastForm, YeastLot, YeastLotUnit } from '@/lib/brewing/types/yeast-lot'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'

/**
 * `LotEditor` — the "add a yeast lot" form used by the Yeast Bank
 * (`yeast-bank-view.tsx`). Fully self-contained: owns every constant/helper it
 * needs (`FORM_LABELS`, `UNIT_OPTIONS`, `toDateInput`/`fromDateInput`,
 * `LotDraft` + validation) so it has no dependency on the old Inventory-tab
 * panel, which has been retired.
 */

const FORM_LABELS: Record<YeastForm, string> = {
  dry: 'Dry',
  liquid: 'Liquid',
  slurry: 'Slurry',
}

const UNIT_OPTIONS: YeastLotUnit[] = ['packet', 'vial', 'mL', 'g']

function toDateInput(iso: string | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

/** Exported so `harvest-form.tsx` reuses the same `<input type="date">` → full-ISO
 *  normalization instead of a 4th private copy (also duplicated in `gear-view.tsx`
 *  / `inventory-view.tsx`) — `YeastLot.productionDate` is `z.string().datetime()`,
 *  which a bare `YYYY-MM-DD` fails. */
export function fromDateInput(date: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T00:00:00.000Z`).toISOString()
}

interface LotDraft {
  name: string
  strain: string
  labId: string
  form: YeastForm
  productionDate: string
  initialCells_B: string
  quantity: string
  unit: YeastLotUnit
  source: string
}

function freshLotDraft(): LotDraft {
  return {
    name: '',
    strain: '',
    labId: '',
    form: 'liquid',
    productionDate: toDateInput(new Date().toISOString()),
    initialCells_B: '',
    quantity: '1',
    unit: 'vial',
    source: '',
  }
}

export function LotEditor({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<LotDraft>(freshLotDraft)

  const update = <K extends keyof LotDraft>(key: K, value: LotDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const name = draft.name.trim()
    const strain = draft.strain.trim()
    if (!name || !strain) {
      toast.error('Name and strain are required')
      return
    }
    const initialCells = Number(draft.initialCells_B)
    if (!Number.isFinite(initialCells) || initialCells <= 0) {
      toast.error('Initial cells (B) must be a positive number')
      return
    }
    const quantity = Number(draft.quantity)
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast.error('Quantity must be zero or more')
      return
    }
    if (!draft.productionDate) {
      toast.error('Production/harvest date is required')
      return
    }

    const now = new Date().toISOString()
    const lot: YeastLot = {
      id: crypto.randomUUID(),
      name,
      strain,
      labId: draft.labId.trim() || undefined,
      form: draft.form,
      productionDate: fromDateInput(draft.productionDate) ?? now,
      initialCells_B: initialCells,
      generation: 0,
      quantity,
      unit: draft.unit,
      source: draft.source.trim() || undefined,
      notes_md: '',
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    }

    try {
      await yeastLotsRepo.save(lot)
      toast.success(`Added "${lot.name}"`)
      onSave()
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 border-b border-border/60 pb-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Name</span>
          <input
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            required
            placeholder="WLP001 California Ale"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Strain</span>
          <input
            value={draft.strain}
            onChange={(e) => update('strain', e.target.value)}
            required
            placeholder="California Ale"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Lab ID (optional)</span>
          <input
            value={draft.labId}
            onChange={(e) => update('labId', e.target.value)}
            placeholder="WLP001"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Form</span>
          <select
            value={draft.form}
            onChange={(e) => update('form', e.target.value as YeastForm)}
            className="field"
          >
            {(Object.keys(FORM_LABELS) as YeastForm[]).map((k) => (
              <option key={k} value={k}>
                {FORM_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Production / harvest date</span>
          <input
            type="date"
            value={draft.productionDate}
            onChange={(e) => update('productionDate', e.target.value)}
            required
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Initial cells (B)</span>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={draft.initialCells_B}
            onChange={(e) => update('initialCells_B', e.target.value)}
            placeholder="100"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Quantity</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={draft.quantity}
            onChange={(e) => update('quantity', e.target.value)}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Unit</span>
          <select
            value={draft.unit}
            onChange={(e) => update('unit', e.target.value as YeastLotUnit)}
            className="field"
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Source (optional)</span>
          <input
            value={draft.source}
            onChange={(e) => update('source', e.target.value)}
            placeholder="Vendor or harvested-from batch"
            className="field"
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary">
          New lot
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  )
}
