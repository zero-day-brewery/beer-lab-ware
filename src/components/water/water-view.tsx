'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { ColumnResizeHandle, useResizableColumns } from '@/components/ui/resizable-columns'
import { type Water, WaterSchema } from '@/lib/brewing/types/ingredient'
import { ION_BAR_FIELDS, type IonBarField, ionBarScale } from '@/lib/brewing/water/ion-bars'
import { so4ClBand, so4ClRatio } from '@/lib/brewing/water/target'
import { waterRepo } from '@/lib/db/repos/water'
import type { ColumnDef } from '@/lib/ui/column-resize'
import { newId } from '@/lib/utils/id'
import { useWaterProfilesStore } from '@/stores/water-profiles-store'

/** The 6 source-water ions, in the same order the brew-start gate presents them. */
const ION_FIELDS = ION_BAR_FIELDS
type IonField = IonBarField

/**
 * Resizable column layout for the comparison grid. Ids line up with the header
 * cells (the 6 ion ids ARE the `IonField` keys) so a handle maps straight to a
 * column. The trailing actions column flexes to fill. Widths persist per table.
 */
const WATER_TABLE_ID = 'water-compare'
const WATER_COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Profile', min: 120, initial: 150 },
  { id: 'Ca_ppm', label: 'Ca', min: 52, initial: 68 },
  { id: 'Mg_ppm', label: 'Mg', min: 52, initial: 68 },
  { id: 'Na_ppm', label: 'Na', min: 52, initial: 68 },
  { id: 'SO4_ppm', label: 'SO₄', min: 52, initial: 68 },
  { id: 'Cl_ppm', label: 'Cl', min: 52, initial: 68 },
  { id: 'HCO3_ppm', label: 'HCO₃', min: 52, initial: 68 },
  { id: 'ratio', label: 'SO₄:Cl', min: 64, initial: 76 },
  { id: 'balance', label: 'Balance', min: 96, initial: 120 },
  { id: 'actions', label: 'Actions', min: 104, flex: true },
]

const ION_LABELS: Record<IonField, string> = {
  Ca_ppm: 'Ca',
  Mg_ppm: 'Mg',
  Na_ppm: 'Na',
  SO4_ppm: 'SO₄',
  Cl_ppm: 'Cl',
  HCO3_ppm: 'HCO₃',
}

/** Per-ion bar tint. Token-driven only — each falls back to a guaranteed token so
 *  every theme resolves it (DESIGN.md law: no hardcoded hex in components). */
const ION_COLORS: Record<IonField, string> = {
  Ca_ppm: 'var(--primary)',
  Mg_ppm: 'var(--hop, var(--primary))',
  Na_ppm: 'var(--foam, var(--muted-foreground))',
  SO4_ppm: 'var(--malt)', // sulfate — the crisp/hoppy driver
  Cl_ppm: 'var(--copper, var(--malt))', // chloride — the malty/round driver
  HCO3_ppm: 'var(--muted-foreground)', // alkalinity — quiet
}

const num = (v: string): number => (v === '' ? 0 : Number(v))

function freshProfile(): Water {
  return {
    id: newId(),
    kind: 'water',
    name: '',
    Ca_ppm: 0,
    Mg_ppm: 0,
    Na_ppm: 0,
    SO4_ppm: 0,
    Cl_ppm: 0,
    HCO3_ppm: 0,
  }
}

/** Human balance verdict for a source profile: which way the SO₄:Cl ratio leans. */
function balanceOf(w: Water): { ratio: number; label: string; text: string } {
  const ratio = so4ClRatio(w)
  const label = so4ClBand(ratio).label
  const text = `${Number.isFinite(ratio) ? ratio.toFixed(2) : '∞'} : 1`
  return { ratio, label, text }
}

/** Token for the balance pill — malty(copper) ↔ balanced(muted) ↔ hoppy(hop). */
function balanceColor(label: string): string {
  if (label.includes('malty') || label.includes('malt-leaning')) return 'var(--copper, var(--malt))'
  if (label.includes('hoppy') || label.includes('hop-forward')) return 'var(--hop, var(--primary))'
  return 'var(--muted-foreground)'
}

export function WaterView() {
  const { profiles, isLoading } = useWaterProfilesStore()
  const [editing, setEditing] = useState<Water | null>(null)
  const { gridTemplateColumns, getHandleProps } = useResizableColumns(WATER_TABLE_ID, WATER_COLUMNS)

  const onSave = async (profile: Water) => {
    try {
      const parsed = WaterSchema.parse(profile)
      await waterRepo.save(parsed)
      toast.success(`Saved "${parsed.name}"`)
      setEditing(null)
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await waterRepo.delete(id)
      toast.success(`Deleted "${name}"`)
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  const sulfateForward = profiles.filter((w) => so4ClRatio(w) > 2).length
  const chlorideForward = profiles.filter((w) => so4ClRatio(w) < 1).length
  // Shared per-ion max across every profile → each row's mini-bars are comparable.
  const { fractions } = ionBarScale(profiles)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="eyebrow">🦴 Waterworks</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Water profiles</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your source-water mineral profiles, side by side — mini-bars scaled to a shared
              per-ion max so you can read all of them at a glance. Same profiles the brew-start gate
              builds salt additions from.
            </p>
          </div>
          <button type="button" onClick={() => setEditing(freshProfile())} className="btn-primary">
            <span aria-hidden="true">＋</span>
            <span>Add water</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="stat-tile">
            <span className="num">{profiles.length}</span>
            <span className="lbl">Profiles</span>
          </div>
          <div className="stat-tile">
            <span className="num">{sulfateForward}</span>
            <span className="lbl">Sulfate-fwd</span>
          </div>
          <div className="stat-tile">
            <span className="num">{chlorideForward}</span>
            <span className="lbl">Chloride-fwd</span>
          </div>
        </div>
      </header>

      {editing && (
        <WaterEditForm
          key={editing.id}
          profile={editing}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {profiles.length === 0 && !editing ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="chip-icon mb-4 !h-16 !w-16 !text-4xl">💧</div>
          <h2 className="text-xl font-semibold">No water profiles — add your source water</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Capture your tap or RO water's mineral content (Ca, Mg, Na, SO₄, Cl, HCO₃) so every brew
            starts from a known baseline.
          </p>
        </div>
      ) : (
        <div className="water-compare-scroll">
          <div className="water-compare">
            <div className="wc-head" style={{ gridTemplateColumns }}>
              <span className="wc-name rz-host">
                Profile
                <ColumnResizeHandle {...getHandleProps('name')} />
              </span>
              {ION_FIELDS.map((k) => (
                <span key={k} className="wc-col rz-host">
                  {ION_LABELS[k]}
                  <ColumnResizeHandle {...getHandleProps(k)} />
                </span>
              ))}
              <span className="wc-col wc-ratio-col rz-host">
                SO₄:Cl
                <ColumnResizeHandle {...getHandleProps('ratio')} />
              </span>
              <span className="wc-balance-col rz-host">
                Balance
                <ColumnResizeHandle {...getHandleProps('balance')} />
              </span>
              <span className="wc-actions" />
            </div>

            {profiles.map((profile, i) => (
              <WaterCompareRow
                key={profile.id}
                profile={profile}
                fractions={fractions[i]}
                gridTemplateColumns={gridTemplateColumns}
                onEdit={() => setEditing(profile)}
                onDelete={() => onDelete(profile.id, profile.name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function WaterCompareRow({
  profile,
  fractions,
  gridTemplateColumns,
  onEdit,
  onDelete,
}: {
  profile: Water
  fractions: Record<IonField, number>
  gridTemplateColumns: string
  onEdit: () => void
  onDelete: () => void
}) {
  const balance = balanceOf(profile)
  return (
    <div className="wc-row" style={{ gridTemplateColumns }}>
      <div className="wc-name">
        <span aria-hidden="true" className="wc-drop">
          💧
        </span>
        <span className="wc-nm" title={profile.name}>
          {profile.name}
        </span>
      </div>

      {ION_FIELDS.map((k) => (
        <div key={k} className="wc-ion" title={`${ION_LABELS[k]} ${profile[k]} ppm`}>
          <span className="wc-ppm">{profile[k]}</span>
          <span className="wc-bar" style={{ ['--ion' as string]: ION_COLORS[k] }}>
            <span
              className="fill"
              data-testid={`bar-${k}`}
              style={{ width: `${(fractions[k] * 100).toFixed(1)}%` }}
            />
          </span>
        </div>
      ))}

      <div className="wc-ratio">{balance.text}</div>

      <div className="wc-balance-col">
        <span className="wc-balance" style={{ ['--bal' as string]: balanceColor(balance.label) }}>
          {balance.label}
        </span>
      </div>

      <div className="wc-actions">
        <button type="button" onClick={onEdit} className="btn-ghost">
          Edit
        </button>
        <button type="button" onClick={onDelete} className="btn-ghost danger">
          Delete
        </button>
      </div>
    </div>
  )
}

function WaterEditForm({
  profile,
  onSave,
  onCancel,
}: {
  profile: Water
  onSave: (profile: Water) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Water>(profile)
  const balance = balanceOf(draft)

  const update = <K extends keyof Water>(key: K, value: Water[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draft)
      }}
      className="tap-card flex flex-col gap-3 p-5"
    >
      <h2 className="text-lg font-semibold">
        {profile.name ? `Edit "${profile.name}"` : 'New water profile'}
      </h2>

      <label className="water-field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(e) => update('name', e.target.value)}
          required
          placeholder="My tap water"
          className="field"
        />
      </label>

      {/* Ion inputs — same 6-field layout the brew-start gate uses (.water-custom). */}
      <div className="water-custom">
        {ION_FIELDS.map((k) => (
          <label key={k}>
            <span>{ION_LABELS[k]}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={draft[k] || ''}
              placeholder="0"
              aria-label={ION_LABELS[k]}
              onChange={(e) => update(k, num(e.target.value))}
            />
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        SO₄:Cl {balance.text} — {balance.label}
      </p>

      <div className="mt-1 flex items-center gap-2">
        <button type="submit" className="btn-primary">
          Save
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  )
}
