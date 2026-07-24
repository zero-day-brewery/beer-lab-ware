'use client'
import { liveQuery } from 'dexie'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useWaterPlan } from '@/components/system/use-water-plan'
import { useDisplayNumberState } from '@/hooks/use-display-units'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { formatWithUnit, unitLabel } from '@/lib/brewing/convert/display-units'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { availableFermenters } from '@/lib/brewing/fermenter-availability'
import { planYeastPitch, type YeastPitchPlan } from '@/lib/brewing/inventory/yeast-pitch-plan'
import { MANUAL_VERSION } from '@/lib/brewing/process'
import {
  makeSessionFromGate,
  type SessionChoices,
  type SessionWaterPlan,
} from '@/lib/brewing/process/session'
import type { Water } from '@/lib/brewing/types/ingredient'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { type IonProfile, type SaltKey, ZERO_PROFILE } from '@/lib/brewing/water/ions'
import { so4ClBand, type WaterStyleKey } from '@/lib/brewing/water/target'
import { sessionRepo } from '@/lib/db/repos/session'
import { waterRepo } from '@/lib/db/repos/water'
import { yeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { reportDbError } from '@/lib/diagnostics/error-log'
import { newId } from '@/lib/utils/id'
import { useBatchesStore } from '@/stores/batches-store'
import { useEquipmentStore } from '@/stores/equipment-store'
import { useRecipesStore } from '@/stores/recipes-store'
import { useSessionStore } from '@/stores/session-store'
import { useSystemStore } from '@/stores/system-store'
import { useWaterProfilesStore } from '@/stores/water-profiles-store'

const SALT_LABEL: Record<SaltKey, string> = {
  gypsum: 'Gypsum (CaSO₄)',
  cacl2: 'Calcium chloride (CaCl₂)',
  epsom: 'Epsom (MgSO₄)',
  nacl: 'Table salt (NaCl)',
  nahco3: 'Baking soda (NaHCO₃)',
}
const STYLE_OPTIONS: { key: WaterStyleKey; label: string }[] = [
  { key: 'light-hoppy', label: 'Light & hoppy (pale ale / WC IPA)' },
  { key: 'neipa', label: 'NEIPA / hazy (chloride-forward)' },
  { key: 'balanced', label: 'Balanced (amber / bitter)' },
  { key: 'amber-malty', label: 'Amber & malty' },
  { key: 'brown-malty', label: 'Brown & malty' },
  { key: 'dark-stout', label: 'Dark / stout' },
  { key: 'pale-lager', label: 'Pale lager / pilsner (soft)' },
]
const num = (v: string): number => (v === '' ? 0 : Number(v))
const ION_FIELDS = ['Ca_ppm', 'Mg_ppm', 'Na_ppm', 'SO4_ppm', 'Cl_ppm', 'HCO3_ppm'] as const

/** Live-query all yeast lots. Mirrors the local liveQuery hook in
 *  `yeast-bank-view.tsx` (no zustand store for lots — see `yeast-lot.ts` doc
 *  comment). */
function useYeastLots(): YeastLot[] {
  const [lots, setLots] = useState<YeastLot[]>([])
  useEffect(() => {
    const sub = liveQuery(() => yeastLotsRepo.list()).subscribe({
      next: (rows) => setLots(rows),
      error: (e) => reportDbError('yeast-lots', e),
    })
    return () => sub.unsubscribe()
  }, [])
  return lots
}

/**
 * Compact display-only pitch recommendation for the chosen recipe's yeast
 * (recipe.yeasts[0]) — reuses `.mini-alert` severity tints (go/warn) so it
 * matches the rest of the app's status language. No writes happen here; brew
 * day still consumes the lot via the normal deduction wiring.
 */
function YeastPitchReadout({ plan }: { plan: YeastPitchPlan }) {
  const { selection } = plan
  if (selection.action === 'pitch' && selection.chosen) {
    return (
      <span className="mini-alert go">
        ✓ {selection.chosen.name} — ~{(selection.chosenViabilityPct ?? 0).toFixed(0)}% est., ~
        {(selection.chosenViableCells_B ?? 0).toFixed(0)} B
      </span>
    )
  }
  if (selection.action === 'pitch-with-starter' && selection.chosen) {
    return (
      <span className="mini-alert warn">
        ⚠ {selection.chosen.name} — ~{(selection.chosenViabilityPct ?? 0).toFixed(0)}% est. — build
        a starter (~{selection.cellDeficit_B.toFixed(0)} B short)
      </span>
    )
  }
  return <span className="mini-alert warn">⚠ no viable lot — make a starter or buy fresh</span>
}

/**
 * Yeast lot picker — lets the brewer confirm (or override) which physical lot
 * is being pitched. Defaults to the recommended lot from `pitchPlan` but the
 * chosen id is held by the caller and recorded on the session/batch root, not
 * derived from the plan at save time (the brewer may swap lots).
 */
function YeastLotPicker({
  lots,
  value,
  onChange,
}: {
  lots: YeastLot[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <select
      aria-label="Yeast lot"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field"
    >
      <option value="">— No lot recorded —</option>
      {lots.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  )
}

export function BrewStartGate({ onClose }: { onClose: () => void }) {
  const { recipes } = useRecipesStore()
  const { profiles: equipment } = useEquipmentStore()
  const { profiles: waters } = useWaterProfilesStore()
  const startBrew = useSystemStore((s) => s.startBrew)
  const fermenters = useSystemStore((s) => s.fermenters)
  const { batches } = useBatchesStore()
  const router = useRouter()

  // Only empty vessels can accept a new brew. Availability is derived from BOTH
  // the local fermenter status AND the synced in-progress batches — the fermenter
  // board is device-local (localStorage, unsynced), so on a second device it
  // reads every vessel 'empty' even while a synced batch occupies it. Keyed on
  // f.id (uuid-or-seed — never assume 'f1' exists), labelled f.name.
  const emptyFermenters = availableFermenters(fermenters, batches)
  const allOccupied = emptyFermenters.length === 0

  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '') // '' = plan manually
  const [fermenterId, setFermenterId] = useState(emptyFermenters[0]?.id ?? '')
  const [carbPath, setCarbPath] = useState<SessionChoices['carbPath']>('co2')
  // null = untouched (fall back to the async-resolved recommendation); '' =
  // brewer explicitly picked "— No lot recorded —"; uuid = an explicit lot.
  // Tri-state so an explicit clear (falsy '') isn't conflated with untouched
  // (also falsy under `||`) — see effectiveYeastLotId below.
  const [chosenYeastLotId, setChosenYeastLotId] = useState<string | null>(null)
  const [manualStyle, setManualStyle] = useState<WaterStyleKey>('balanced')
  // Edited in display units (gal when imperial); `.canonical` is liters.
  const manualVolume = useDisplayNumberState(30, 'volume')
  const units = manualVolume.units
  const [sourceId, setSourceId] = useState('') // '' = custom
  const [custom, setCustom] = useState<IonProfile>(ZERO_PROFILE)

  const recipe = recipes.find((r) => r.id === recipeId)
  const source: Water | IonProfile = waters.find((w) => w.id === sourceId) ?? custom
  const sourceName = waters.find((w) => w.id === sourceId)?.name ?? 'Custom'

  const eq = recipe
    ? (equipment.find((p) => p.id === recipe.equipmentProfileId) ?? B40PRO_PROFILE)
    : B40PRO_PROFILE
  const calc = useWaterPlan({
    recipe,
    equipment: eq,
    source,
    sourceName,
    manualStyle,
    manualVolume_L: Math.max(0, manualVolume.canonical ?? 0),
    now: new Date().toISOString(),
  })

  // Yeast pitch recommendation, alongside the fermenter picker. Style detection
  // isn't reliable off Recipe today (no ale/lager field on the yeast snapshot
  // or a structured BJCP family) — 'ale' is the documented default.
  const yeastLots = useYeastLots()
  const recipeYeast = recipe?.yeasts[0]
  const pitchPlan = useMemo<YeastPitchPlan | null>(() => {
    if (!recipe || !recipeYeast) return null
    let result: ReturnType<typeof calculateRecipe>
    try {
      result = calculateRecipe(recipe, eq, new Date().toISOString())
    } catch {
      return null
    }
    return planYeastPitch({
      og: result.OG,
      batchSize_L: recipe.batchSize_L,
      style: 'ale',
      strain: recipeYeast.snapshot.name,
      lots: yeastLots,
    })
  }, [recipe, recipeYeast, eq, yeastLots])

  // The picker defaults to the recommended lot until the brewer overrides it;
  // an explicit pick always wins over a later-resolving recommendation. Use
  // `??` (not `||`) so an explicit "no lot" pick (chosenYeastLotId === '')
  // is preserved rather than falling back to the recommendation — only
  // `null` (untouched) should fall back.
  const recommendedYeastLotId = pitchPlan?.selection?.chosen?.id ?? ''
  const effectiveYeastLotId = chosenYeastLotId ?? recommendedYeastLotId

  async function launchSession(water?: SessionWaterPlan) {
    const session = makeSessionFromGate({
      id: newId(),
      now: Date.now(),
      recipeId: recipe?.id,
      recipeName: recipe?.name,
      fermenterId: fermenterId || undefined,
      yeastLotId: effectiveYeastLotId || undefined,
      manualVersion: MANUAL_VERSION,
      water,
      recipe,
      choices: { carbPath },
    })
    const saved = await sessionRepo.save(session)
    await useSessionStore.getState().setActive(saved)
    router.push(`/system/run/?session=${saved.id}`)
  }

  async function confirm() {
    startBrew({
      recipeId: recipe?.id,
      recipeName: recipe?.name,
      sourceProfileName: sourceName,
      additionsSummary: calc?.summary ?? '',
    })
    await launchSession({
      sourceProfileName: sourceName,
      additionsSummary: calc?.summary ?? '',
      skipped: false,
      estMashPh: calc?.mash?.ph,
    })
    onClose()
  }
  async function skip() {
    startBrew({ recipeId: recipe?.id, recipeName: recipe?.name, skipped: true })
    await launchSession({ skipped: true })
    onClose()
  }
  async function saveCustom() {
    try {
      await waterRepo.save({
        id: newId(),
        kind: 'water',
        name: `Custom ${new Date().toISOString().slice(0, 10)}`,
        ...custom,
      })
      toast.success('Saved water profile')
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    }
  }

  return (
    <div
      className="water-overlay"
      style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
    >
      <div className="water-modal tap-card">
        <header className="water-modal-head">
          <h3 className="text-base font-semibold">Water chemistry for this brew</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cancel">
            ✕
          </button>
        </header>

        <label className="water-field">
          <span>Recipe</span>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className="field">
            <option value="">— None (plan manually) —</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="water-field">
          <span>Fermenter</span>
          <select
            value={fermenterId}
            onChange={(e) => setFermenterId(e.target.value)}
            className="field"
            disabled={allOccupied}
          >
            {emptyFermenters.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {allOccupied && (
            <small className="water-warn">
              All fermenters are in use — free one on the Brew Flow board first
            </small>
          )}
        </label>

        {recipe && recipeYeast && (
          <div className="water-field">
            <span>Yeast pitch — {recipeYeast.snapshot.name}</span>
            {pitchPlan ? (
              <YeastPitchReadout plan={pitchPlan} />
            ) : (
              <small className="water-warn">Unable to estimate OG for this recipe yet.</small>
            )}
            <YeastLotPicker
              lots={yeastLots}
              value={effectiveYeastLotId}
              onChange={setChosenYeastLotId}
            />
          </div>
        )}

        <div className="water-field">
          <span>Carbonation method</span>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              type="button"
              className={carbPath === 'co2' ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setCarbPath('co2')}
              aria-pressed={carbPath === 'co2'}
            >
              CO2
            </button>
            <button
              type="button"
              className={carbPath === 'nitro' ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setCarbPath('nitro')}
              aria-pressed={carbPath === 'nitro'}
            >
              Nitro
            </button>
          </div>
        </div>

        {!recipe && (
          <div className="water-field-row">
            <label className="water-field">
              <span>Water style</span>
              <select
                value={manualStyle}
                onChange={(e) => setManualStyle(e.target.value as WaterStyleKey)}
                className="field"
              >
                {STYLE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="water-field">
              <span>Total water ({unitLabel('volume', units)})</span>
              <input
                type="number"
                value={manualVolume.text}
                onChange={(e) => manualVolume.setText(e.target.value)}
                className="field"
              />
            </label>
          </div>
        )}

        <label className="water-field">
          <span>Source water</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="field">
            <option value="">Custom…</option>
            {waters.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        {sourceId === '' && (
          <div className="water-custom">
            {ION_FIELDS.map((k) => (
              <label key={k}>
                <span>{k.replace('_ppm', '')}</span>
                <input
                  type="number"
                  value={custom[k] || ''}
                  placeholder="0"
                  onChange={(e) => setCustom({ ...custom, [k]: num(e.target.value) })}
                />
              </label>
            ))}
            <button type="button" className="btn-ghost" onClick={saveCustom}>
              Save as profile
            </button>
          </div>
        )}

        {calc ? (
          <div className="water-readout">
            <div className="water-row">
              <b>Target</b>
              <span>
                {calc.styleKey} · for {formatWithUnit(calc.totalWater_L, 'volume', units, 1)} total
                water
              </span>
            </div>
            <div>
              <div className="water-block-title">Salt additions</div>
              <ul className="water-salts">
                {(Object.keys(calc.add.grams) as SaltKey[])
                  .filter((k) => calc.add.grams[k] > 0.05)
                  .map((k) => (
                    <li key={k}>
                      <span>{SALT_LABEL[k]}</span>
                      <b>{calc.add.grams[k].toFixed(1)} g</b>
                    </li>
                  ))}
                {calc?.noAdditions && <li>No additions needed.</li>}
              </ul>
            </div>
            <div className="water-row">
              <b>Resulting</b>
              <span>
                Ca {calc.add.result.Ca_ppm.toFixed(0)} · Mg {calc.add.result.Mg_ppm.toFixed(0)} · Na{' '}
                {calc.add.result.Na_ppm.toFixed(0)} · SO₄ {calc.add.result.SO4_ppm.toFixed(0)} · Cl{' '}
                {calc.add.result.Cl_ppm.toFixed(0)} · HCO₃ {calc.add.result.HCO3_ppm.toFixed(0)}
              </span>
            </div>
            <div className="water-row">
              <b>SO₄:Cl</b>
              <span>
                {Number.isFinite(calc.add.so4cl) ? calc.add.so4cl.toFixed(2) : '∞'} : 1 —{' '}
                {so4ClBand(calc.add.so4cl).label}
              </span>
            </div>
            {calc.mash ? (
              <div className="water-row">
                <b>Est. mash pH</b>
                <span>
                  {calc.mash.ph.toFixed(2)} <small>(±0.15 — confirm with a meter)</small>
                  {calc.acid && (
                    <>
                      {' '}
                      → add {calc.acid.lactic88_mL.toFixed(1)} mL 88% lactic{' '}
                      <small>or {calc.acid.acidMaltPct.toFixed(1)}% acid malt</small>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <div className="water-row">
                <b>Est. mash pH</b>
                <span className="text-muted-foreground">pick a recipe to estimate mash pH</span>
              </div>
            )}
            {calc.add.warnings.map((wn) => (
              <div key={wn} className="water-warn">
                ⚠ {wn}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter a total water volume to see the plan.
          </p>
        )}

        <footer className="water-actions">
          <button type="button" className="btn-ghost" onClick={skip} disabled={allOccupied}>
            I've got my water — skip
          </button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={allOccupied}>
            Confirm &amp; start
          </button>
        </footer>
      </div>
    </div>
  )
}
