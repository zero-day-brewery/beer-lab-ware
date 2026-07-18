'use client'
import { useSearchParams } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FermentationChart } from '@/components/charts/fermentation-chart'
import { DeductionReview } from '@/components/inventory/deduction-review'
import { BatchActions } from '@/components/logbook/batch-actions'
import { BatchCostSection } from '@/components/logbook/batch-cost-section'
import { StarRating } from '@/components/ui/star-rating'
import { HarvestForm } from '@/components/yeast/harvest-form'
import { useBatchReadings } from '@/hooks/use-batch-readings'
import { useDisplayUnits } from '@/hooks/use-display-units'
import { formatAmount, unitLabel } from '@/lib/brewing/convert/display-units'
import { cToF } from '@/lib/brewing/convert/temp'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Reading, ReadingSource } from '@/lib/brewing/types/reading'
import type { Units } from '@/lib/brewing/types/settings'
import { batchRepo } from '@/lib/db/repos/batch'
import { readingsRepo } from '@/lib/db/repos/readings'
import { newId } from '@/lib/utils/id'
import { useSettingsStore } from '@/stores/settings-store'

/** Flatten a Batch's measured results + logs into a key→value lookup the brew
 *  sheet uses to fill its Actual column. Pure — unit-tested directly. */
export function buildActualMap(b: Batch): Record<string, number | string | boolean> {
  const map: Record<string, number | string | boolean> = {}
  for (const [k, v] of Object.entries(b.results)) {
    if (v !== undefined) map[k] = v as number | string
  }
  for (const log of b.logs) {
    map[log.key] = log.value
  }
  return map
}

function fmt(v: number | string | boolean | undefined): string {
  if (v === undefined) return '—'
  if (typeof v === 'number') return v.toFixed(3).replace(/\.?0+$/, '')
  return String(v)
}

/** datetime-local wants local wall-clock (no zone). Build "YYYY-MM-DDTHH:mm". */
function nowLocalInput(): string {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

/** Parse a form field: '' or non-finite → undefined, else the number. */
function parseField(s: string): number | undefined {
  if (s.trim() === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Pure: turn the raw add-reading form strings into a `Reading` (canonical °C),
 * or `null` if nothing measurable was entered. Extracted so the conversion +
 * parse-guard logic is unit-testable without a DOM.
 */
export function buildReadingFromForm(
  input: { at: string; gravity: string; temp: string; ph: string; note: string },
  batchId: string,
  units: Units,
): Reading | null {
  const gravity = parseField(input.gravity)
  const tempDisplay = parseField(input.temp)
  const tempC =
    tempDisplay === undefined
      ? undefined
      : units === 'imperial'
        ? ((tempDisplay - 32) * 5) / 9
        : tempDisplay
  const ph = parseField(input.ph)
  const note = input.note.trim() === '' ? undefined : input.note.trim()

  if (gravity === undefined && tempC === undefined && ph === undefined && note === undefined) {
    return null
  }
  const at = input.at ? new Date(input.at).toISOString() : new Date().toISOString()
  return { id: newId(), batchId, at, gravity, tempC, ph, note, schemaVersion: 1 }
}

/** Label + Tailwind color per reading source — `undefined` (the pre-existing
 *  hand-typed path) reads as "manual", muted; every automatic source (see
 *  `reading-ingest.ts`) gets its own color so a glance at the table shows
 *  which rows a sensor logged vs. what was typed in. */
const SOURCE_BADGE: Record<'manual' | ReadingSource, { label: string; className: string }> = {
  manual: { label: 'manual', className: 'bg-muted text-muted-foreground' },
  tilt: { label: 'Tilt', className: 'bg-rose-500/15 text-rose-500' },
  ispindel: { label: 'iSpindel', className: 'bg-sky-500/15 text-sky-500' },
  rapt: { label: 'RAPT', className: 'bg-violet-500/15 text-violet-400' },
  other: { label: 'sensor', className: 'bg-amber-500/15 text-amber-500' },
}

function SourceBadge({ source }: { source?: ReadingSource }) {
  const { label, className } = SOURCE_BADGE[source ?? 'manual']
  return (
    <span
      className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}
      data-testid="reading-source-badge"
    >
      {label}
    </span>
  )
}

function FermentationReadings({ batchId }: { batchId: string }) {
  const readings = useBatchReadings(batchId)
  const { settings } = useSettingsStore()
  const units: Units = settings?.units ?? 'metric'
  const tempUnit = units === 'imperial' ? '°F' : '°C'
  const displayTemp = (c: number) => (units === 'imperial' ? cToF(c) : c)

  const [at, setAt] = useState(nowLocalInput)
  const [gravity, setGravity] = useState('')
  const [temp, setTemp] = useState('')
  const [ph, setPh] = useState('')
  const [note, setNote] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const reading = buildReadingFromForm({ at, gravity, temp, ph, note }, batchId, units)
    if (!reading) return
    await readingsRepo.create(reading)
    setAt(nowLocalInput())
    setGravity('')
    setTemp('')
    setPh('')
    setNote('')
  }

  return (
    <section className="logsheet-section">
      <h2 className="logsheet-section-title">Fermentation Readings</h2>

      <form className="ferment-form" onSubmit={onSubmit}>
        <label className="ferment-field">
          <span>When</span>
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            aria-label="Reading time"
          />
        </label>
        <label className="ferment-field">
          <span>Gravity</span>
          <input
            type="number"
            step="0.001"
            value={gravity}
            placeholder="1.040"
            onChange={(e) => setGravity(e.target.value)}
            aria-label="Gravity"
          />
        </label>
        <label className="ferment-field">
          <span>Temp {tempUnit}</span>
          <input
            type="number"
            step="0.1"
            value={temp}
            placeholder={units === 'imperial' ? '68' : '20'}
            onChange={(e) => setTemp(e.target.value)}
            aria-label={`Temperature ${tempUnit}`}
          />
        </label>
        <label className="ferment-field">
          <span>pH</span>
          <input
            type="number"
            step="0.01"
            value={ph}
            placeholder="4.4"
            onChange={(e) => setPh(e.target.value)}
            aria-label="pH"
          />
        </label>
        <label className="ferment-field ferment-field--note">
          <span>Note</span>
          <input
            type="text"
            value={note}
            placeholder="optional"
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
          />
        </label>
        <button type="submit" className="ferment-add">
          Log reading
        </button>
      </form>

      <FermentationChart readings={readings} units={units} />

      {readings.length > 0 && (
        <table className="sheet-table ferment-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>SG</th>
              <th>Temp {tempUnit}</th>
              <th>pH</th>
              <th>Note</th>
              <th>Source</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.at).toLocaleString()}</td>
                <td className="sheet-actual">
                  {r.gravity === undefined ? '—' : r.gravity.toFixed(3)}
                </td>
                <td className="sheet-actual">
                  {r.tempC === undefined ? '—' : displayTemp(r.tempC).toFixed(1)}
                </td>
                <td className="sheet-actual">{r.ph === undefined ? '—' : r.ph.toFixed(2)}</td>
                <td>{r.note ?? '—'}</td>
                <td>
                  <SourceBadge source={r.source} />
                </td>
                <td>
                  <button
                    type="button"
                    className="ferment-del"
                    onClick={() => readingsRepo.delete(r.id)}
                    aria-label="Delete reading"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** '' / whitespace-only → undefined so blank fields don't persist as ""; else the raw value. */
function noteOrUndef(s: string): string | undefined {
  return s.trim() === '' ? undefined : s
}

/**
 * Editable Tasting section — the batch sheet's FIRST write-back path. A 0–5 star
 * rating + five note fields (Aroma/Appearance/Flavor/Mouthfeel/Overall), seeded
 * from `batch.tasting`. Save writes the FULL batch object via `batchRepo.save`
 * (re-stamps updatedAt + Zod-validates) and hands the validated batch back to the
 * sheet. Shown for any status.
 */
export function TastingEditor({ batch, onSaved }: { batch: Batch; onSaved: (b: Batch) => void }) {
  const t = batch.tasting
  const [rating, setRating] = useState<number>(t?.rating ?? 0)
  const [aroma, setAroma] = useState(t?.aroma_md ?? '')
  const [appearance, setAppearance] = useState(t?.appearance_md ?? '')
  const [flavor, setFlavor] = useState(t?.flavor_md ?? '')
  const [mouthfeel, setMouthfeel] = useState(t?.mouthfeel_md ?? '')
  const [overall, setOverall] = useState(t?.overall_md ?? '')
  const [saving, setSaving] = useState(false)

  const dirty =
    rating !== (t?.rating ?? 0) ||
    aroma !== (t?.aroma_md ?? '') ||
    appearance !== (t?.appearance_md ?? '') ||
    flavor !== (t?.flavor_md ?? '') ||
    mouthfeel !== (t?.mouthfeel_md ?? '') ||
    overall !== (t?.overall_md ?? '')

  async function onSave() {
    setSaving(true)
    try {
      const saved = await batchRepo.save({
        ...batch,
        tasting: {
          ...batch.tasting,
          // 0 = unrated → drop the field so the list shows no stars.
          rating: rating > 0 ? rating : undefined,
          aroma_md: noteOrUndef(aroma),
          appearance_md: noteOrUndef(appearance),
          flavor_md: noteOrUndef(flavor),
          mouthfeel_md: noteOrUndef(mouthfeel),
          overall_md: noteOrUndef(overall),
        },
      })
      onSaved(saved)
      toast.success('Tasting notes saved')
    } catch (err) {
      console.error('save tasting failed', err)
      toast.error('Could not save tasting notes')
    } finally {
      setSaving(false)
    }
  }

  const fields: Array<{
    key: string
    label: string
    value: string
    set: (v: string) => void
  }> = [
    { key: 'aroma', label: 'Aroma', value: aroma, set: setAroma },
    { key: 'appearance', label: 'Appearance', value: appearance, set: setAppearance },
    { key: 'flavor', label: 'Flavor', value: flavor, set: setFlavor },
    { key: 'mouthfeel', label: 'Mouthfeel', value: mouthfeel, set: setMouthfeel },
    { key: 'overall', label: 'Overall', value: overall, set: setOverall },
  ]

  return (
    <section className="logsheet-section">
      <h2 className="logsheet-section-title">Tasting</h2>

      <div className="ferment-field">
        <span>Rating</span>
        <StarRating value={rating} onChange={setRating} label="Batch rating" />
      </div>

      {fields.map((f) => (
        <label key={f.key} className="ferment-field">
          <span>{f.label}</span>
          <textarea
            className="field"
            rows={3}
            value={f.value}
            onChange={(e) => f.set(e.target.value)}
            aria-label={`${f.label} notes`}
          />
        </label>
      ))}

      <div>
        <button type="button" className="btn-primary" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save tasting'}
        </button>
      </div>
    </section>
  )
}

export function BatchSheetView() {
  const params = useSearchParams()
  const id = params.get('id')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [missing, setMissing] = useState(false)
  const [showDeduct, setShowDeduct] = useState(false)
  const [showHarvest, setShowHarvest] = useState(false)
  const units = useDisplayUnits()
  // Actuals arrive as canonical liters (number) or preformatted strings; only
  // numbers are converted for display.
  const fmtVol = (v: number | string | boolean | undefined): string =>
    typeof v === 'number' ? formatAmount(v, 'volume', units) : fmt(v)

  useEffect(() => {
    let alive = true
    if (!id) {
      setMissing(true)
      return
    }
    batchRepo.get(id).then((b) => {
      if (!alive) return
      if (b) setBatch(b)
      else setMissing(true)
    })
    return () => {
      alive = false
    }
  }, [id])

  if (missing) return <p className="logsheet-empty">Batch not found.</p>
  if (!batch) return <p className="logsheet-empty">Loading batch…</p>

  const actual = buildActualMap(batch)
  const t = batch.computedTargets // undefined for manual brews with no recipe

  return (
    <article className="logsheet">
      <header className="logsheet-head">
        <h1 className="logsheet-title">
          #{batch.batchNo} · {batch.name}
        </h1>
        <span className={`logsheet-chip logsheet-chip--${batch.status}`}>{batch.status}</span>
        <BatchActions batch={batch} />
      </header>

      <section className="logsheet-section">
        <h2 className="logsheet-section-title">Gravity &amp; ABV</h2>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Metric</th>
              {t && <th>Target</th>}
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OG</td>
              {t && <td>{t.OG.toFixed(3)}</td>}
              <td className="sheet-actual">{fmt(actual.measuredOG)}</td>
            </tr>
            <tr>
              <td>FG</td>
              {t && <td>{t.FG.toFixed(3)}</td>}
              <td className="sheet-actual">{fmt(actual.measuredFG)}</td>
            </tr>
            <tr>
              <td>ABV</td>
              {t && <td>{t.ABV.toFixed(2)}%</td>}
              <td className="sheet-actual">{fmt(actual.measuredABV)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="logsheet-section">
        <h2 className="logsheet-section-title">Volumes ({unitLabel('volume', units)})</h2>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Stage</th>
              {t && <th>Target</th>}
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pre-boil</td>
              {t && <td>{formatAmount(t.volumes.preBoilVolume_L, 'volume', units)}</td>}
              <td className="sheet-actual">{fmtVol(actual.preBoilVolume_L)}</td>
            </tr>
            <tr>
              <td>Into fermenter</td>
              {t && <td>{formatAmount(t.volumes.intoFermenter_L, 'volume', units)}</td>}
              <td className="sheet-actual">{fmtVol(actual.intoFermenter_L)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {batch.recipeSnapshot && (
        <section className="logsheet-section">
          <h2 className="logsheet-section-title">Inventory</h2>
          <p className="logsheet-notes">
            Deduct this batch's grain, hops, yeast, and salts from the pantry. Reviewable — nothing
            leaves stock until you confirm.
          </p>
          <button type="button" className="btn-primary" onClick={() => setShowDeduct(true)}>
            Deduct ingredients
          </button>
        </section>
      )}

      {batch.status !== 'archived' && (
        <section className="logsheet-section">
          <h2 className="logsheet-section-title">Yeast</h2>
          <p className="logsheet-notes">
            Harvest slurry from this batch's pitch into a new gen+1 lot in the Yeast Bank.
          </p>
          <button type="button" className="btn-primary" onClick={() => setShowHarvest(true)}>
            Harvest yeast
          </button>
        </section>
      )}

      <BatchCostSection batch={batch} />

      <FermentationReadings batchId={batch.id} />

      {showDeduct && <DeductionReview batch={batch} onClose={() => setShowDeduct(false)} />}

      {showHarvest && <HarvestForm batch={batch} onDone={() => setShowHarvest(false)} />}

      <TastingEditor batch={batch} onSaved={setBatch} />
    </article>
  )
}
