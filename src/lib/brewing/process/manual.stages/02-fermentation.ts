import type { ProcessStage, ProcessStep } from '../types'

const steps: ProcessStep[] = [
  // ── Step 1 ──────────────────────────────────────────────────────────────────
  {
    id: 'confirm-pressure-rated',
    title: 'Confirm the fermenter is pressure-rated & PRV works',
    body_md:
      'Confirm you are using a pressure-capable **Spike FLEX+** (not a carboy or bucket). Locate the PRV and spunding valve; confirm they are free-moving and unobstructed. Pull the PRV ring to verify it lifts and re-seats cleanly. Note the MAWP (~15 psi); cap working pressure ~12 psi for headroom.\n\nIf the vessel is not pressure-rated, ferment open with an airlock and skip all spunding steps.',
    values: [],
    logs: [
      {
        key: 'pressure-rated',
        label: 'Vessel is pressure-rated (FLEX+)',
        kind: 'bool',
        required: true,
      },
      { key: 'prv-verified', label: 'PRV lifts & re-seats', kind: 'bool' },
      { key: 'mawp', label: 'MAWP (psi)', kind: 'number', unit: 'psi' },
    ],
    timers: [],
    enterEffects: [{ t: 'stageFocus', stage: 'fermentation' }],
    safety_md:
      '⚠ **Only a rated pressure vessel (Spike FLEX+, MAWP ~15 psi) may be sealed under fermentation pressure.** Never seal glass carboys or non-rated plastic buckets. Hand-off from the CFC — wort arrives near pitch temp.',
  },

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  {
    id: 'confirm-pitch-temp',
    title: 'Confirm chilled wort at / below pitch temp',
    body_md:
      'Read the wort temperature inside the fermenter. If warm, set the glycol and let it pull down before pitching. If too cold (lager), let glycol bring it up gently.\n\nToo hot stresses yeast (fusels/esters); too cold drags lag phase. CFC outlet tracks flow + groundwater temp — board temperature is °F, calc stores °C (convert as needed).',
    values: [],
    logs: [
      {
        key: 'wort-temp',
        label: 'Wort temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        writesTo: { target: 'fermenter', field: 'tempC' },
      },
    ],
    timers: [],
    safety_md:
      '⚠ Treat a chiller-fault-hot vessel or hose as scalding. Check for pressure before opening any fitting.',
  },

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  {
    id: 'oxygenate-wort',
    title: 'Oxygenate wort (open lag phase only)',
    body_md:
      'For an open lag phase: dose pure O2 via a stone ~30–60 s or aerate vigorously to ~8–10 ppm dissolved oxygen (up to ~12 ppm for high-gravity beers). Air caps ~8 ppm; pure O2 ~60 s ≈ 12 ppm.\n\nIf sealing and pressurising from minute zero, use an over-pitch or well-oxygenated starter instead — oxygenating and then pressurising is a safety/contamination mismatch.\n\nGlycol can run during oxygenation to hold pitch temp.',
    values: [],
    logs: [
      { key: 'oxy-method', label: 'Oxygenation method', kind: 'text' },
      { key: 'oxy-duration', label: 'Duration (s)', kind: 'time', unit: 's' },
    ],
    timers: [
      {
        id: 'o2-dose',
        label: 'O2 stone dose',
        durationFrom: { kind: 'fixed', minutes: 1 },
      },
    ],
    branch: { t: 'not', of: { t: 'pressureFromPitch' } },
    safety_md:
      '⚠ **Pure O2 is a powerful oxidiser — keep away from flame and ignition sources. Never oxygenate a vessel you then immediately pressurise.**',
  },

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  {
    id: 'confirm-pitch-rate',
    title: 'Confirm pitch rate & cell count',
    body_md:
      'Compute cell target = rate × volume(mL) × °Plato. Ales: 0.75 M cells/mL/°P; lagers and pressure fermentations: ~1.0–1.5 M cells/mL/°P.\n\n**Dry yeast:** ~20 B cells/g **total**, ~150 B viable per sachet — do not call 200 B "viable".\n\nCell count is the biggest lever on clean attenuation. Pressure suppresses esters but viability still matters; under-pitching is what makes real FG miss the predicted value.',
    values: [
      { key: 'pitchCells_B', label: 'Target pitch cells (B)', source: 'calc', precision: 0 },
    ],
    logs: [
      {
        key: 'cells-pitched',
        label: 'Cells pitched (est., B)',
        kind: 'number',
        unit: 'B',
        required: true,
        targetValueKey: 'pitchCells_B',
      },
      { key: 'packs-starter', label: 'Packs / starter / slurry', kind: 'text' },
    ],
    timers: [],
  },

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  {
    id: 'pitch-yeast',
    title: 'Pitch yeast & seal',
    body_md:
      "Sanitize the pitch port or opening. Pitch the yeast, close and torque the lid, fit the spunding valve and PRV.\n\n**Open-lag path:** leave the spunding valve open (or use a blow-off tube) during high krausen — set it only after krausen settles (~12–48 h) so trub does not clog the valve.\n\n**Full-pressure path:** set the spunding valve next (Step 8) after confirming krausen activity.\n\nRecording OG here anchors the board's attenuation/progress/ABV math.",
    values: [],
    logs: [
      {
        key: 'actual-pitch-temp',
        label: 'Actual pitch temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
      {
        key: 'og-at-pitch',
        label: 'OG at pitch',
        kind: 'gravity',
        required: true,
        writesTo: { target: 'fermenter', field: 'og' },
      },
    ],
    timers: [],
    completeEffects: [{ t: 'fermenter', to: 'fermenting' }],
    safety_md:
      '⚠ **Do not seal AND pressurise until the spunding valve is set — keep the valve open or on blow-off until high krausen settles.**',
  },

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  {
    id: 'set-glycol-temp',
    title: 'Set glycol to fermentation temp',
    body_md:
      'Set the FLEX+ jacket setpoint (Inkbird/controller), start the Penguin glycol chiller, and confirm cold glycol circulates and the temperature probe reads wort (not jacket).\n\nAles: hold low early, allow free-rise late; lagers: hold cold throughout.\n\n**Penguin is one 1/3 HP unit (2,000 BTU/hr @ 28°F) cooling all 4 vessels — stagger heavy cooling and crash demand to avoid overloading it.**\n\nTemp is the dominant flavour control. Pressure + accurate setpoint lets you ferment warm-and-fast yet clean.',
    values: [],
    logs: [
      {
        key: 'glycol-setpoint',
        label: 'Glycol setpoint (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
      { key: 'current-temp', label: 'Current wort temp (°C)', kind: 'temp', unit: '°C' },
    ],
    timers: [],
    safety_md:
      '⚠ Mains + water near liquid — GFCI required; use dry connectors; route glycol lines so a leak cannot reach wort; use food-grade glycol only.',
  },

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  {
    id: 'calc-spunding-pressure',
    title: 'Calculate spunding pressure for your CO2 target',
    body_md:
      'Decide your target CO2 volume, then compute the gauge pressure that will dissolve it at fermentation temperature (CO2 solubility falls as temperature rises).\n\n**Verified values (CORRECTED):** at 12°C — 10 psi ≈ 1.8 vol, 15 psi ≈ 2.2 vol, 18–23 psi ≈ 2.4–2.7 vol. Those upper values **exceed the FLEX+ MAWP (~15 psi)**, so cap spunding at ~12 psi (≈ 2.0 vol at 12°C) and finish the rest via force-carb cold in the keg.\n\nFor nitro beers, target ~1.2–1.5 vol CO2 now — beer-gas adds the N2 character in Stage 3.',
    values: [
      {
        key: 'spundingSetpoint_psi',
        label: 'Spunding setpoint (psi)',
        source: 'choice',
        unit: 'psi',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'target-vols',
        label: 'Target CO2 vols',
        kind: 'number',
        unit: 'vol',
        required: true,
      },
      {
        key: 'computed-setpoint',
        label: 'Computed spunding setpoint (psi)',
        kind: 'number',
        unit: 'psi',
        required: true,
        targetValueKey: 'spundingSetpoint_psi',
      },
    ],
    timers: [],
    safety_md:
      '⚠ **Never set the spunding valve at or above MAWP.** spunding ≤ MAWP (cap ~12 psi, finish cold in keg).',
  },

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  {
    id: 'set-spunding-valve',
    title: 'Set the spunding valve & begin capturing CO2',
    body_md:
      'Once high krausen settles (~12–48 h post-pitch, or after gravity drops a few points below OG), dial the spunding valve to the capped setpoint. Watch one full burp cycle — confirm the valve relieves at setpoint, not the PRV.\n\nSetting too early clogs the valve with krausen trub → runaway pressure to the PRV. Setting SG a few points below OG is the right trigger.',
    values: [
      {
        key: 'spundingSetpoint_psi',
        label: 'Spunding setpoint (psi)',
        source: 'choice',
        unit: 'psi',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'valve-set-at',
        label: 'Valve set at (psi)',
        kind: 'number',
        unit: 'psi',
        required: true,
        targetValueKey: 'spundingSetpoint_psi',
      },
      {
        key: 'head-pressure',
        label: 'Head pressure (psi)',
        kind: 'number',
        unit: 'psi',
        required: true,
      },
      { key: 'sg-when-set', label: 'SG when valve set', kind: 'gravity' },
    ],
    timers: [
      {
        id: 'krausen-settle',
        label: 'Krausen settle window',
        durationFrom: { kind: 'fixed', minutes: 1440 },
      },
    ],
    safety_md:
      '⚠ **Watch a full burp cycle to confirm the spunding valve relieves at setpoint — the PRV must NOT be the thing relieving.** Never lean over a pressurised fitting. Bleed pressure before touching any seal. spunding ≤ MAWP (cap ~12 psi, finish cold in keg).',
  },

  // ── Step 9 ──────────────────────────────────────────────────────────────────
  {
    id: 'track-gravity',
    title: 'Track gravity over days',
    body_md:
      'Every 1–3 days: bleed a little head pressure, draw a sample, read SG. Use the in-app refractometer helper (Sean Terrill cubic) to correct for alcohol — an uncorrected refractometer reads high (false "finished").\n\nThe attenuation curve shows fermentation health and catches a stuck fermentation early. EasyDens pairs with manual entry. **Do not enter raw Brix into the SG field.**',
    values: [
      { key: 'correctedFG', label: 'Predicted FG', source: 'calc', precision: 3 },
      {
        key: 'attenuationPct',
        label: 'Expected attenuation',
        source: 'recipe',
        unit: '%',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'current-sg',
        label: 'Current SG (corrected)',
        kind: 'gravity',
        required: true,
        writesTo: { target: 'fermenter', field: 'sg' },
      },
      { key: 'sample-temp', label: 'Sample temp (°C)', kind: 'temp', unit: '°C' },
      {
        key: 'apparent-attenuation',
        label: 'Apparent attenuation (%)',
        kind: 'number',
        unit: '%',
        required: true,
        targetValueKey: 'attenuationPct',
      },
    ],
    timers: [
      {
        id: 'gravity-check',
        label: 'Next gravity reading',
        durationFrom: { kind: 'fixed', minutes: 2880 },
      },
    ],
    safety_md:
      '⚠ Bleed pressure **slowly** before drawing a sample. Wear eye protection when venting a pressurised vessel.',
  },

  // ── Step 10 ─────────────────────────────────────────────────────────────────
  {
    id: 'closed-dry-hop',
    title: 'Closed / pressure dry-hop',
    body_md:
      'Add dry hops via a CO2-purged dry-hop port or cannister under counter-pressure — **never by opening the lid on a pressurised vessel.** Keep the spunding valve managing any hop-creep CO2 that follows.\n\nOxygen dulls hop aroma within days; a closed pressurised addition is the only clean method. Contact time ~3–5 days; avoid grassy over-contact. Watch for pressure creep from hop yeast activity.',
    values: [{ key: 'hop', label: 'Dry-hop charges', source: 'recipe' }],
    logs: [
      {
        key: 'dryhop-added',
        label: 'Dry hop added (g)',
        kind: 'number',
        unit: 'g',
        required: true,
        targetValueKey: 'hop',
      },
      {
        key: 'pressure-after',
        label: 'Head pressure after (psi)',
        kind: 'number',
        unit: 'psi',
        required: true,
      },
    ],
    timers: [
      {
        id: 'dryhop-contact',
        label: 'Dry-hop contact',
        durationFrom: { kind: 'fixed', minutes: 5760 },
      },
    ],
    branch: { t: 'hasDryHop' },
    safety_md:
      '⚠ **Only add dry hops through a rated, CO2-pre-purged port. Never open a pressurised lid to dump hops.** Monitor for hop-creep pressure rise.',
  },

  // ── Step 11 ─────────────────────────────────────────────────────────────────
  {
    id: 'diacetyl-rest',
    title: 'Diacetyl rest',
    body_md:
      'Near terminal gravity (~75–90% apparent attenuation), raise the glycol setpoint for a free-rise and hold ~48 h so active yeast reabsorb diacetyl and acetaldehyde.\n\nWarm active yeast clean these up before dormancy — the only window is while yeast are still active. Trigger: gravity at ~75–90% of the OG→FG range.\n\nLager: raise to ~62–68°F; ale: raise to fermentation temp or 2–4°F above.\n\n**Warming raises head pressure — confirm the spunding valve still relieves below MAWP after the temperature rises.**',
    values: [],
    logs: [
      {
        key: 'rest-temp',
        label: 'Diacetyl rest temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
      { key: 'sg-at-rest', label: 'SG at rest start', kind: 'gravity', required: true },
    ],
    timers: [
      {
        id: 'diacetyl-rest',
        label: 'Diacetyl rest',
        durationFrom: { kind: 'fixed', minutes: 2880 },
      },
    ],
    safety_md:
      '⚠ Heater element = mains near liquid (GFCI). **Warming raises head pressure — confirm the spunding valve relieves below MAWP after setpoint increase.**',
  },

  // ── Step 12 ─────────────────────────────────────────────────────────────────
  {
    id: 'confirm-terminal-gravity',
    title: 'Confirm terminal gravity (stable 2–3 days)',
    body_md:
      'Take two or more readings 2–3 days apart. Both must be identical within ~0.001 SG and at/near predicted FG. Investigate a large miss (under-pitch, temperature excursion, stuck fermentation).\n\nPackaging an active beer → over-carbonation and over-pressure in the keg. The board "ready to cold-crash" alert gates on FG being entered, not just SG.',
    values: [{ key: 'correctedFG', label: 'Predicted FG', source: 'calc', precision: 3 }],
    logs: [
      {
        key: 'fg-reading-1',
        label: 'FG reading #1',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
      },
      {
        key: 'fg-reading-2',
        label: 'FG reading #2 (+48–72 h)',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
      },
    ],
    timers: [
      {
        id: 'fg-confirm-wait',
        label: 'Confirming gravity wait',
        durationFrom: { kind: 'fixed', minutes: 2880 },
      },
    ],
    safety_md: '⚠ Bleed pressure slowly before drawing each sample. Eye protection when venting.',
  },

  // ── Step 13 ─────────────────────────────────────────────────────────────────
  {
    id: 'cold-crash',
    title: 'Cold-crash via glycol',
    body_md:
      'Drop the glycol setpoint to ~32–38°F (~0–3°C). Keep the fermenter **sealed with the spunding valve in place**. As temperature falls, CO2 solubility rises and head pressure drops — this creates a vacuum/suck-back risk if the vessel is not kept at slight positive pressure.\n\nKeep a small positive CO2 source connected, or rely on dissolved CO2 already in suspension. Hold 24–48 h until the beer is bright and compact yeast has settled.\n\n**Penguin (one 1/3 HP unit) serves all 4 vessels — stagger crash timing to avoid overloading.**',
    values: [],
    logs: [
      { key: 'crash-temp', label: 'Crash temp (°C)', kind: 'temp', unit: '°C', required: true },
      {
        key: 'head-pressure-crash',
        label: 'Head pressure (psi, keep ≥ 0)',
        kind: 'number',
        unit: 'psi',
        required: true,
      },
    ],
    timers: [
      {
        id: 'cold-crash',
        label: 'Cold crash',
        durationFrom: { kind: 'fixed', minutes: 2160 },
      },
    ],
    completeEffects: [{ t: 'fermenter', to: 'cold-crash' }],
    safety_md:
      '⚠ **SUCK-BACK RISK — never let a sealed fermenter go negative pressure during crash; keep slight positive CO2 at all times.** Glycol near electrics — GFCI required. cold-crash suck-back — keep positive CO2.',
  },

  // ── Step 14 ─────────────────────────────────────────────────────────────────
  {
    id: 'nitro-target-low-co2',
    title: '[Nitro] Target LOW CO2 during fermentation',
    body_md:
      'For nitro beers, carbonate to a **low** CO2 level (~1.2–1.5 vol) with plain CO2 during spunding. Do not aim for a standard carbonation level — nitrogen and creaminess are added on the keg side in Stage 3.\n\nAt 66°F (~19°C), ~6–7 psi sets ≈ 1.4 vol CO2. A spunded stout may already be at or below the nitro target — just confirm and move on.\n\n**Use plain CO2 to set the level — mixed beer-gas cannot hit a precise CO2 target.** Beer-gas handling belongs entirely to Stage 3.',
    values: [],
    logs: [
      {
        key: 'nitro-co2-target',
        label: 'CO2 target (vols, nitro)',
        kind: 'number',
        unit: 'vol',
        required: true,
      },
    ],
    timers: [],
    branch: { t: 'carbPath', eq: 'nitro' },
    safety_md:
      '⚠ **Use plain CO2 to set carbonation level for nitro beer — mixed gas (beer-gas) cannot hit a CO2 target.** Beer-gas and nitro dispense pressure belong to Stage 3. nitro 30 psi IN THE KEG only, never the 15-psi fermenter.',
  },
]

export const FERMENTATION_STAGE: ProcessStage = {
  id: 'fermentation',
  title: 'Fermentation — Pressure / Spunding + Glycol',
  steps,
}
