'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDisplayNumberState } from '@/hooks/use-display-units'
import { calcOG } from '@/lib/brewing/calc/gravity'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { srmToHex } from '@/lib/brewing/calc/srm-color'
import {
  formatAmount,
  formatForInput,
  formatWithUnit,
  unitLabel,
} from '@/lib/brewing/convert/display-units'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { duplicateRecipe } from '@/lib/brewing/recipe/duplicate'
import { scaleRecipe, scaleToOG, withFreshTargets } from '@/lib/brewing/recipe/scale'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { db } from '@/lib/db/schema'
import { formatGravity } from '@/lib/format/gravity'
import { newId } from '@/lib/utils/id'
import { useEquipmentStore } from '@/stores/equipment-store'

type ScaleMode = 'size' | 'og'

const grainMassKg = (r: Recipe): number => r.fermentables.reduce((a, f) => a + f.amount_kg, 0)

export function RecipeActions({ recipe }: { recipe: Recipe }) {
  const router = useRouter()
  const { profiles } = useEquipmentStore()
  const equipment = profiles.find((p) => p.id === recipe.equipmentProfileId) ?? B40PRO_PROFILE

  const [scaling, setScaling] = useState(false)
  const [mode, setMode] = useState<ScaleMode>('size')
  // Edited in display units (gal when imperial); `newSize.canonical` is liters.
  const newSize = useDisplayNumberState(recipe.batchSize_L, 'volume')
  const units = newSize.units
  const [targetOG, setTargetOG] = useState(() =>
    (recipe.targets?.OG ?? calcOG(recipe, equipment)).toFixed(3),
  )

  // Live before → after preview. Recomputes the proposed scaled recipe and its
  // full calc whenever the inputs change; an invalid input yields a null scaled
  // recipe (Apply disabled) plus a hint. The scaled recipe carries a fresh id,
  // so this is also the exact object saved on Apply.
  const preview = useMemo(() => {
    const now = new Date().toISOString()
    const before = calculateRecipe(recipe, equipment, now)
    let scaled: Recipe | null = null
    let error: string | null = null
    try {
      if (mode === 'size') {
        const size = newSize.canonical
        if (size == null || size <= 0) throw new Error('Enter a batch size greater than 0')
        scaled = scaleRecipe(recipe, size)
      } else {
        const og = Number(targetOG)
        if (!Number.isFinite(og) || og <= 1) throw new Error('Enter a target OG greater than 1.000')
        scaled = scaleToOG(recipe, equipment, og)
      }
    } catch (e) {
      error = (e as Error).message
    }
    const after = scaled ? calculateRecipe(scaled, equipment, now) : null
    return { before, scaled, after, error }
  }, [recipe, equipment, mode, newSize.canonical, targetOG])

  async function onDuplicate() {
    const copy = duplicateRecipe(recipe, { id: newId(), now: new Date().toISOString() })
    try {
      const saved = await recipeRepo.save(copy)
      toast.success(`Duplicated "${recipe.name}"`)
      // Open the new copy the same way a recipe card opens a recipe.
      router.push(`/recipes/view/?id=${saved.id}`)
    } catch (err) {
      toast.error(`Duplicate failed: ${(err as Error).message}`)
    }
  }

  async function onScaleConfirm() {
    const scaled = preview.scaled
    if (!scaled) {
      toast.error(preview.error ?? 'Enter a valid target')
      return
    }
    try {
      const fresh = withFreshTargets(scaled, equipment, new Date().toISOString())
      const saved = await recipeRepo.save(fresh)
      setScaling(false)
      toast.success(
        mode === 'size'
          ? `Scaled to ${formatWithUnit(scaled.batchSize_L, 'volume', units)}`
          : `Scaled to OG ${Number(targetOG).toFixed(3)}`,
      )
      router.push(`/recipes/view/?id=${saved.id}`)
    } catch (err) {
      toast.error(`Scale failed: ${(err as Error).message}`)
    }
  }

  async function onDelete() {
    const snapshot = recipe
    try {
      await recipeRepo.delete(recipe.id)
      router.push('/')
      toast(`Deleted "${snapshot.name}"`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: async () => {
            await db.recipes.put(snapshot)
            toast.success(`Restored "${snapshot.name}"`)
          },
        },
      })
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Link href={`/recipes/edit/?id=${recipe.id}`} className="btn-primary">
        Edit
      </Link>
      <button type="button" className="btn-ghost" onClick={onDuplicate}>
        Duplicate
      </button>
      <button type="button" className="btn-ghost" onClick={() => setScaling(true)}>
        Scale
      </button>
      <button type="button" className="btn-ghost" onClick={() => window.print()}>
        Print
      </button>
      <button type="button" className="btn-ghost danger" onClick={onDelete}>
        Delete
      </button>

      {scaling && (
        <div
          className="water-overlay"
          style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
        >
          <div className="water-modal tap-card">
            <header className="water-modal-head">
              <h3 className="text-base font-semibold">Scale recipe</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setScaling(false)}
                aria-label="Cancel"
              >
                ✕
              </button>
            </header>

            <p className="text-xs text-muted-foreground">
              Creates a new recipe; "{recipe.name}" stays untouched. By batch size, grain, hops
              &amp; miscs scale together (OG holds). By target OG, only the grain bill moves.
            </p>

            <div className="water-field">
              <span>Scale by</span>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className={mode === 'size' ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setMode('size')}
                  aria-pressed={mode === 'size'}
                >
                  By batch size
                </button>
                <button
                  type="button"
                  className={mode === 'og' ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setMode('og')}
                  aria-pressed={mode === 'og'}
                >
                  By target OG
                </button>
              </div>
            </div>

            {mode === 'size' ? (
              <label className="water-field">
                <span>New batch size ({unitLabel('volume', units)})</span>
                <input
                  type="number"
                  step={units === 'imperial' ? '0.25' : '0.5'}
                  min="0"
                  value={newSize.text}
                  onChange={(e) => newSize.setText(e.target.value)}
                  className="field"
                />
              </label>
            ) : (
              <label className="water-field">
                <span>Target OG</span>
                <input
                  type="number"
                  step="0.001"
                  min="1.001"
                  value={targetOG}
                  onChange={(e) => setTargetOG(e.target.value)}
                  className="field"
                />
              </label>
            )}

            <div className="water-readout">
              <div className="water-block-title">Preview</div>
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Batch size ({unitLabel('volume', units)})</td>
                    <td>{formatForInput(recipe.batchSize_L, 'volume', units)}</td>
                    <td>
                      {preview.scaled
                        ? formatForInput(preview.scaled.batchSize_L, 'volume', units)
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>OG</td>
                    <td>{formatGravity(preview.before.OG)}</td>
                    <td>{preview.after ? formatGravity(preview.after.OG) : '—'}</td>
                  </tr>
                  <tr>
                    <td>IBU</td>
                    <td>{preview.before.IBU.toFixed(0)}</td>
                    <td>{preview.after ? preview.after.IBU.toFixed(0) : '—'}</td>
                  </tr>
                  <tr>
                    <td>SRM</td>
                    <td>
                      <SrmCell srm={preview.before.SRM} />
                    </td>
                    <td>{preview.after ? <SrmCell srm={preview.after.SRM} /> : '—'}</td>
                  </tr>
                  <tr>
                    <td>Total grain ({unitLabel('mass-grain', units)})</td>
                    <td>{formatAmount(grainMassKg(recipe), 'mass-grain', units)}</td>
                    <td>
                      {preview.scaled
                        ? formatAmount(grainMassKg(preview.scaled), 'mass-grain', units)
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
              {preview.error && <div className="water-warn">⚠ {preview.error}</div>}
            </div>

            <footer className="water-actions">
              <button type="button" className="btn-ghost" onClick={() => setScaling(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onScaleConfirm}
                disabled={!preview.scaled}
              >
                Apply
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

function SrmCell({ srm }: { srm: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span className="sheet-swatch" style={{ background: srmToHex(srm) }} aria-hidden="true" />
      {srm.toFixed(1)}
    </span>
  )
}
