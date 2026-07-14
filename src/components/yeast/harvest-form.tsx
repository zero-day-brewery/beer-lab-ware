'use client'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { fromDateInput } from '@/components/yeast/lot-editor'
import { planHarvest } from '@/lib/brewing/inventory/yeast-harvest'
import type { Batch } from '@/lib/brewing/types/batch'
import { type YeastLot, YeastLotSchema } from '@/lib/brewing/types/yeast-lot'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { reportDbError } from '@/lib/diagnostics/error-log'

/**
 * `HarvestForm` — the "harvest slurry into a new lot" modal, wired into two
 * entry points: standalone from a lineage node (`parentLot`) and from a
 * batch's sheet (`batch`). Wraps `planHarvest` (pure) for the live preview +
 * `canSave` gate, and normalizes the `<input type="date">` value to full ISO
 * (`fromDateInput`, from `lot-editor.tsx`) before it ever reaches
 * `YeastLotSchema` (`productionDate` is `z.string().datetime()`).
 */
type HarvestFormProps =
  | { parentLot: YeastLot; batch?: undefined; onDone: () => void }
  | { batch: Batch; parentLot?: undefined; onDone: () => void }

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Case-insensitive, trimmed match of the recipe snapshot's yeast product name
 * against either `lot.name` or `lot.strain`. Mirrors `brew-start-gate.tsx`'s
 * pitch-planner lookup (`strain: recipeYeast.snapshot.name`) — the recipe
 * snapshot only carries a product `name` ("WLP001 California Ale"), never a
 * `strain` field, while `YeastLot.strain` is the shorter grouping key
 * ("California Ale"). Lots created via harvest/`LotEditor` commonly reuse the
 * product-name convention for `name`, so checking both fields is the
 * name-based (not strain-based) default the design calls for.
 */
function matchLotByName(lots: YeastLot[], targetName: string | undefined): YeastLot | undefined {
  if (!targetName) return undefined
  const target = targetName.trim().toLowerCase()
  return lots.find(
    (l) => l.name.trim().toLowerCase() === target || l.strain.trim().toLowerCase() === target,
  )
}

/** Live-query all yeast lots — powers the batch-case parent picker. Only
 *  subscribes when `enabled` (no picker needed ⇒ no live query running). */
function useAllYeastLots(enabled: boolean): YeastLot[] {
  const [lots, setLots] = useState<YeastLot[]>([])
  useEffect(() => {
    if (!enabled) return
    const sub = liveQuery(() => yeastLotsRepo.list()).subscribe({
      next: setLots,
      error: (e) => reportDbError('yeast-lots', e),
    })
    return () => sub.unsubscribe()
  }, [enabled])
  return lots
}

export function HarvestForm(props: HarvestFormProps) {
  const { onDone } = props
  const directParent = props.parentLot
  const batch = props.batch

  // Batch case, recorded pitch (`batch.yeastLotId` set): load that exact lot.
  const [recordedParent, setRecordedParent] = useState<YeastLot | undefined>(undefined)
  const [recordedLookupDone, setRecordedLookupDone] = useState(!batch?.yeastLotId)
  useEffect(() => {
    if (!batch?.yeastLotId) return
    let alive = true
    yeastLotsRepo
      .get(batch.yeastLotId)
      .then((lot) => {
        if (!alive) return
        setRecordedParent(lot)
        setRecordedLookupDone(true)
      })
      .catch((e) => {
        reportDbError('yeast-lots', e)
        if (alive) setRecordedLookupDone(true)
      })
    return () => {
      alive = false
    }
  }, [batch?.yeastLotId])

  // Batch case, no recorded pitch (or the recorded lot no longer exists): a
  // picker, defaulted to a name-based match against the recipe snapshot.
  const showPicker =
    !directParent && (!batch?.yeastLotId || (recordedLookupDone && !recordedParent))
  const allLots = useAllYeastLots(showPicker)
  const targetName = batch?.recipeSnapshot?.yeasts?.[0]?.snapshot?.name
  const defaultMatch = useMemo(() => matchLotByName(allLots, targetName), [allLots, targetName])
  const [pickedLotId, setPickedLotId] = useState('')
  const selectedLotId = pickedLotId || defaultMatch?.id || ''
  const pickedParent = allLots.find((l) => l.id === selectedLotId)

  const parent: YeastLot | undefined =
    directParent ?? recordedParent ?? (showPicker ? pickedParent : undefined)

  const [dateInput, setDateInput] = useState(todayDateInput)
  const [volumeInput, setVolumeInput] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const harvestDateIso = fromDateInput(dateInput) ?? new Date().toISOString()
  const volumeNum = Number(volumeInput)
  const slurryVolume_mL = Number.isFinite(volumeNum) ? volumeNum : 0

  const plan = useMemo(() => {
    if (!parent) return null
    return planHarvest({
      parentLot: parent,
      slurryVolume_mL,
      harvestDate: harvestDateIso,
      batchId: batch?.id,
    })
  }, [parent, slurryVolume_mL, harvestDateIso, batch?.id])

  async function onConfirm() {
    if (!plan?.canSave || saving) return
    setSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const lot = YeastLotSchema.parse({
        ...plan.draft,
        notes_md: notes,
        id: crypto.randomUUID(),
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      await yeastLotsRepo.save(lot)
      toast.success(`Harvested "${lot.name}" — gen ${lot.generation}`)
      onDone()
    } catch (err) {
      toast.error(`Harvest failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const loadingRecordedParent = !directParent && !!batch?.yeastLotId && !recordedLookupDone

  return (
    <div
      className="water-overlay"
      style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
    >
      <div className="water-modal tap-card">
        <header className="water-modal-head">
          <h3 className="text-base font-semibold">
            🌾 Harvest yeast{parent ? ` — ${parent.name}` : ''}
          </h3>
          <button
            type="button"
            className="icon-btn"
            onClick={onDone}
            aria-label="Close harvest form"
          >
            ✕
          </button>
        </header>

        {showPicker && (
          <label className="water-field">
            <span>Parent lot</span>
            {!batch?.recipeSnapshot && (
              <small className="water-warn">
                We didn't record the pitch for this batch — pick the lot you harvested from.
              </small>
            )}
            <select
              className="field"
              value={selectedLotId}
              onChange={(e) => setPickedLotId(e.target.value)}
              aria-label="Parent lot"
            >
              <option value="">— choose a lot —</option>
              {allLots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} (gen {l.generation})
                </option>
              ))}
            </select>
          </label>
        )}

        {!parent ? (
          <p className="text-sm text-muted-foreground">
            {loadingRecordedParent
              ? 'Loading the recorded pitch…'
              : 'Pick a parent lot to see the harvest preview.'}
          </p>
        ) : (
          <>
            <label className="water-field">
              <span>Slurry volume (mL)</span>
              <input
                type="number"
                min="0"
                step="1"
                className="field"
                value={volumeInput}
                onChange={(e) => setVolumeInput(e.target.value)}
                placeholder="200"
                aria-label="Slurry volume in mL"
              />
            </label>

            <label className="water-field">
              <span>Harvest date</span>
              <input
                type="date"
                className="field"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                aria-label="Harvest date"
              />
            </label>

            <label className="water-field">
              <span>Notes (optional)</span>
              <textarea
                className="field"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-label="Harvest notes"
              />
            </label>

            {plan && (
              <div className="water-readout">
                <div className="water-row">
                  <b>Estimated cells</b>
                  <span>
                    ~{plan.estimatedCells_B.toFixed(1)} B · gen {plan.draft.generation}
                  </span>
                </div>
                {plan.warnings.map((w) => (
                  <div key={w} className="water-warn">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <footer className="water-actions">
          <button type="button" className="btn-ghost" onClick={onDone}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!plan?.canSave || saving}
            onClick={onConfirm}
          >
            {saving ? 'Saving…' : 'Confirm harvest'}
          </button>
        </footer>
      </div>
    </div>
  )
}
