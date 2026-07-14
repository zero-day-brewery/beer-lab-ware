import type { ProcessStage, ProcessStep } from '../types'

const steps: ProcessStep[] = [
  // ── Step 1 ──────────────────────────────────────────────────────────────────
  {
    id: 'select-recipe-start',
    title: 'Select recipe & start session',
    body_md:
      'Open the batch, confirm equipment profile = **B40pro (US110V)**, sanity-check OG/FG/ABV/IBU/SRM on the read-only brew sheet, then start the session.\n\nThe profile bakes in Steam-Hat boil-off, 4% shrinkage, 1.0 L/kg absorption, 2.0 L + 0.5 L dead spaces — factory defaults pending calibration after batch #1.',
    values: [
      { key: 'targetOG', label: 'Target OG', source: 'calc', precision: 3 },
      { key: 'targetFG', label: 'Target FG', source: 'calc', precision: 3 },
      { key: 'targetABV', label: 'Target ABV', source: 'calc', unit: '%', precision: 1 },
      { key: 'targetIBU', label: 'Target IBU', source: 'calc', precision: 0 },
      { key: 'targetSRM', label: 'Target SRM', source: 'calc', precision: 0 },
    ],
    logs: [
      { key: 'recipe-confirmed', label: 'Recipe confirmed', kind: 'bool' },
      {
        key: 'equipment-profile-ok',
        label: 'Equipment profile = B40pro',
        kind: 'bool',
        required: true,
      },
    ],
    timers: [],
    enterEffects: [{ t: 'startSession' }, { t: 'stageFocus', stage: 'prep' }],
    safety_md:
      'A mismatched equipment profile silently breaks strike water, sparge water, and pre-boil volume calculations.',
  },

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  {
    id: 'read-batch-numbers',
    title: 'Read & write down batch numbers',
    body_md:
      'Capture strike/sparge/pre-boil/post-boil/into-fermenter volumes, strike temp, and each mash step onto a physical card at the rig. Paper backup is essential for wet hands when the laptop sleeps.\n\n"Sparge water" rinses the lifted malt pipe — this is a single vessel, no HLT.',
    values: [
      { key: 'mashWater_L', label: 'Strike water', source: 'calc', unit: 'L', precision: 1 },
      { key: 'spargeWater_L', label: 'Sparge water', source: 'calc', unit: 'L', precision: 1 },
      { key: 'preBoilVolume_L', label: 'Pre-boil volume', source: 'calc', unit: 'L', precision: 1 },
      {
        key: 'postBoilVolume_L',
        label: 'Post-boil volume',
        source: 'calc',
        unit: 'L',
        precision: 1,
      },
      {
        key: 'intoFermenter_L',
        label: 'Into fermenter',
        source: 'calc',
        unit: 'L',
        precision: 1,
      },
      { key: 'strikeTemp_C', label: 'Strike temp', source: 'calc', unit: '°C', precision: 1 },
      {
        key: 'mashStepTemp_C',
        label: 'Mash step temp',
        source: 'calc',
        unit: '°C',
        precision: 1,
      },
      {
        key: 'mashStepTime_min',
        label: 'Mash step duration',
        source: 'calc',
        unit: 'min',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'strike-volume',
        label: 'Strike volume (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'mashWater_L',
      },
      {
        key: 'sparge-volume',
        label: 'Sparge volume (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'spargeWater_L',
      },
      {
        key: 'strike-temp',
        label: 'Strike temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        targetValueKey: 'strikeTemp_C',
      },
    ],
    timers: [],
  },

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  {
    id: 'stage-measure-water',
    title: 'Stage & measure water',
    body_md:
      'Decide source (RO/tap/mixed), stage strike + sparge + ~4 L margin (~37 L total), measure by weight (1 L ≈ 1.0 kg). Pour strike volume into the vessel; hold sparge water somewhere heatable.\n\nFill through the seated malt pipe to wet the recirc path and avoid a dry pump start.',
    values: [
      { key: 'mashWater_L', label: 'Strike into vessel', source: 'calc', unit: 'L', precision: 1 },
      { key: 'spargeWater_L', label: 'Sparge staged', source: 'calc', unit: 'L', precision: 1 },
    ],
    logs: [
      { key: 'water-source', label: 'Water source', kind: 'text' },
      {
        key: 'total-water-measured',
        label: 'Total water measured (L)',
        kind: 'number',
        unit: 'L',
        required: true,
      },
      {
        key: 'strike-in-vessel',
        label: 'Strike water in vessel (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'mashWater_L',
      },
    ],
    timers: [],
    safety_md:
      '⚠ **B40 Pro UNPLUGGED / element off while filling** — never pour water around a powered controller. Element must be fully submerged before it is ever energized.',
  },

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  {
    id: 'run-water-chemistry-gate',
    title: 'Run water-chemistry gate & add salts',
    body_md:
      'Open the Brew-Start water gate (Brew System → source profile → target water). It computes salts, SO4:Cl ratio, estimated mash pH, and acid — **do not re-derive independently**.\n\nWeigh salts on a 0.1 g scale; split mash vs sparge fractions; add mash salts to recirculating strike water. Confirm or skip-with-reason.\n\nMash pH 5.2–5.5 (room temp) drives conversion; gate accuracy is ±0.1–0.2 pH.\n\nDissolve salts under slow recirc; **never mix baking soda and acid in one volume**.',
    values: [
      { key: 'salts', label: 'Salt additions', source: 'water' },
      { key: 'so4cl', label: 'SO4:Cl ratio', source: 'water', precision: 1 },
      { key: 'estMashPh', label: 'Est. mash pH', source: 'water', precision: 2 },
      {
        key: 'acidLactic_mL',
        label: 'Lactic acid (mL)',
        source: 'water',
        unit: 'mL',
        precision: 2,
      },
    ],
    logs: [
      { key: 'water-source', label: 'Water source', kind: 'text' },
      {
        key: 'salts-added',
        label: 'Salts added (g)',
        kind: 'number',
        unit: 'g',
        required: true,
        targetValueKey: 'salts',
      },
      {
        key: 'acid-added',
        label: 'Acid added (mL)',
        kind: 'number',
        unit: 'mL',
        required: true,
        targetValueKey: 'acidLactic_mL',
      },
      {
        key: 'predicted-ph',
        label: 'Predicted mash pH',
        kind: 'number',
        required: true,
        targetValueKey: 'estMashPh',
      },
    ],
    timers: [],
    safety_md:
      '⚠ Acid is corrosive — wear eye protection. Add acid INTO water, never reverse. Keep acid off the B40 panel and controller. Never mix baking soda and acid in one volume.',
  },

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  {
    id: 'mill-grain',
    title: 'Mill / receive grain',
    body_md:
      'Mill at ~0.9–1.1 mm or confirm a good pre-mill (husks intact, endosperm cracked). Too fine → compacted malt pipe + stuck recirc; too coarse → low efficiency.\n\nLean slightly coarser than BIAB for RIMS recirc. **Max grist 9 kg** — confirm the bill fits.',
    values: [{ key: 'fermentable', label: 'Grain bill', source: 'recipe' }],
    logs: [
      { key: 'crush-check', label: 'Crush quality OK', kind: 'bool' },
      { key: 'mill-gap', label: 'Mill gap (mm)', kind: 'number', unit: 'mm' },
    ],
    timers: [],
    safety_md: '⚠ Clamp drill mills securely. Mill dust is combustible — no open flames nearby.',
  },

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  {
    id: 'weigh-grain',
    title: 'Weigh grain bill',
    body_md:
      'Weigh each fermentable (±5 g), verify the grand total equals recipe mashed grain. Grain mass drives strike water, absorption, sparge, and OG — a 5% base-malt miss equals ~0.002–0.003 OG deviation.\n\nIf total differs >2–3% from recipe, re-run the calc so strike water/temp track the actual ratio.',
    values: [{ key: 'fermentable', label: 'Mashed grain bill', source: 'recipe' }],
    logs: [
      {
        key: 'each-malt',
        label: 'Each malt weighed',
        kind: 'bool',
        required: true,
        targetValueKey: 'fermentable',
      },
      { key: 'total-grain', label: 'Total grain (kg)', kind: 'number', unit: 'kg', required: true },
    ],
    timers: [],
  },

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  {
    id: 'weigh-bag-hops',
    title: 'Weigh & bag hops by boil time',
    body_md:
      "Weigh each addition (±1 g), label with name/grams/exact boil minute (or whirlpool/first-wort/dry-hop). Lay out in firing order; refrigerate late/aroma/dry-hop additions.\n\nIBU depends on AA × weight × time at average boil gravity. Steam Hat retains heat on late additions — trust the app's Tinseth number.\n\nUse a hop spider/Trubinator or pause recirc on heavy whirlpool charges.",
    values: [
      { key: 'hop', label: 'Hop additions', source: 'recipe' },
      { key: 'targetIBU', label: 'Bittering IBU (Tinseth)', source: 'calc', precision: 0 },
    ],
    logs: [
      {
        key: 'each-hop',
        label: 'Each hop weighed & bagged',
        kind: 'bool',
        required: true,
        targetValueKey: 'hop',
      },
      { key: 'bags-labeled', label: 'Bags labeled in order', kind: 'bool' },
    ],
    timers: [],
  },

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  {
    id: 'weigh-adjuncts',
    title: 'Weigh adjuncts, finings, whirlfloc',
    body_md:
      'Weigh each misc into labeled, time-tagged containers. Note kettle vs fermenter vs packaging additions. Kettle finings (e.g. Whirlfloc) added ~10–15 min from flameout clear the wort.\n\nDissolve kettle sugars under recirc to avoid scorching the element. Whirlfloc + Trubinator work together for cold-side clarity.',
    values: [{ key: 'misc', label: 'Misc / adjuncts', source: 'recipe' }],
    logs: [
      {
        key: 'each-adjunct',
        label: 'Each adjunct/fining weighed',
        kind: 'bool',
        required: true,
        targetValueKey: 'misc',
      },
    ],
    timers: [],
    branch: { t: 'hasMiscs' },
  },

  // ── Step 9 ──────────────────────────────────────────────────────────────────
  {
    id: 'compute-pitch-rate',
    title: 'Compute pitch rate & prep yeast',
    body_md:
      "Target ~0.75 M cells/mL/°P (ale) or ~1.5 (lager / high-gravity). Convert OG to °Plato (≈(OG−1)×1000/4), × volume(mL) × rate = cell target. Compare to pack/vial viability; prep (rehydrate / starter / slurry / direct).\n\n**Dry yeast:** ~20 B cells/g total, ~150 B viable per sachet — do not assume 200 B viable.\n\nUnder-pitch → esters/fusels/diacetyl/stuck; over-pitch strips esters; pressure suppresses esters but does not replace proper pitch rate. Pre-cool the glycol chiller; don't lean on pressure to fix an under-pitch.",
    values: [
      { key: 'pitchCells_B', label: 'Target pitch cells (B)', source: 'calc', precision: 0 },
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
        key: 'pitch-target',
        label: 'Pitch target (B cells)',
        kind: 'number',
        unit: 'B',
        required: true,
        targetValueKey: 'pitchCells_B',
      },
      { key: 'packs-starter', label: 'Packs / starter / slurry', kind: 'text' },
      { key: 'prep-method', label: 'Prep method', kind: 'text' },
    ],
    timers: [
      {
        id: 'dry-rehydration',
        label: 'Dry yeast rehydration',
        durationFrom: { kind: 'fixed', minutes: 20 },
      },
    ],
  },

  // ── Step 10 ─────────────────────────────────────────────────────────────────
  {
    id: 'cold-side-sanitation',
    title: 'Full cold-side sanitation pass',
    body_md:
      'Sanitize everything wort touches **after** the boil: CFC Pro, post-boil hoses/fittings, fermenter + lid/gaskets, spunding valve, dip tubes, closed-transfer line, disconnects. Cover until use.\n\nPost-boil wort is unprotected by heat; a CFC core hides residue. Pre-flush and prime the CFC so brew day only sends hot wort through it.\n\n**Contact time:** Star San ~1.5 mL/L, ~1–2 min, no-rinse. Drain and cover — do not rinse.',
    values: [],
    logs: [
      { key: 'cold-side-checklist', label: 'Cold-side checklist complete', kind: 'bool' },
      { key: 'sanitizer-contact', label: 'Contact time met', kind: 'bool' },
    ],
    timers: [
      {
        id: 'sanitizer-contact',
        label: 'Sanitizer contact',
        durationFrom: { kind: 'fixed', minutes: 2 },
      },
    ],
    safety_md:
      '⚠ Sanitizer is acid — wear eye protection. Do not use bleach. Never sanitize hot surfaces.',
  },

  // ── Step 11 ─────────────────────────────────────────────────────────────────
  {
    id: 'assemble-b40',
    title: 'Assemble the B40 Pro & seat the malt pipe',
    body_md:
      'Confirm clean element/pump. Install false bottom, seat the malt pipe, fit the Trubinator, attach recirc/sparge manifold + Steam Hat. Use fresh TC gaskets and snug every clamp.\n\nOne pinched gasket leaks hot wort mid-recirc; an unseated pipe lets grain clog the pump. Use spare DN20/DN15 gaskets + Viton O-rings if any look compressed. The Trubinator accounts for the 2.0 L kettle dead space.',
    values: [],
    logs: [{ key: 'assembly-checklist', label: 'Assembly checklist complete', kind: 'bool' }],
    timers: [],
    safety_md:
      '⚠ **Keep unplugged throughout assembly.** Element MUST be fully submerged before it is ever energized — dry-firing burns it out and is a fire risk.',
  },

  // ── Step 12 ─────────────────────────────────────────────────────────────────
  {
    id: 'leak-element-pump-dryrun',
    title: 'Leak / element / pump dry-run',
    body_md:
      'With strike water in and the element submerged, plug into a **GFCI** circuit. Briefly fire the element (watch temp climb), prime and run the pump at low flow, walk every joint for drips. Stop when: element heats, pump circulates, zero leaks.\n\nLast chance to catch a bad gasket/air-lock/element fault on water, not wort.\n\n**US110V = 2×1.6 kW on two independent 110V/15A circuits (two breakers) — do not share a circuit.** Bleed air to prime the RIMS loop. Element heat test ~1–2 min then cut power.',
    values: [],
    logs: [
      { key: 'element-heats', label: 'Element heats (temp rises)', kind: 'bool' },
      { key: 'pump-circulates', label: 'Pump circulates', kind: 'bool' },
      { key: 'zero-leaks', label: 'Zero leaks at all joints', kind: 'bool' },
    ],
    timers: [
      {
        id: 'element-heat-test',
        label: 'Element heat test',
        durationFrom: { kind: 'fixed', minutes: 2 },
      },
    ],
    completeEffects: [{ t: 'station', station: 'brew', to: 'idle' }],
    safety_md:
      '⚠ **Mains + water: GFCI required, dry hands and controller at all times.** Never dry-fire the element. Kill power at the source on any drip or hot smell. US110V = 2×1.6 kW across two independent 110V/15A circuits — do not share a circuit.',
  },

  // ── Step 13 ─────────────────────────────────────────────────────────────────
  {
    id: 'stage-fermenter-glycol',
    title: 'Stage pressure fermenter & glycol',
    body_md:
      'Position the sanitized **Spike FLEX+** (MAWP ~15 psi), connect the glycol loop, set the temperature setpoint, and pre-cool. Confirm the vessel rating, finger-check the spunding valve and PRV, cap all gas/liquid/wort-in fittings.\n\nReady CO2 (and beer-gas bottle if nitro) regulators but do not connect yet.\n\nPre-cool to pitch temp so the wort hits the right temperature immediately post-CFC.\n\n**Spunding pressure caution:** to capture 2.4–2.7 vol naturally at ~12°C the spunding valve must hold ~18–23 psi, which exceeds the FLEX+ MAWP. Cap spunding low (~12 psi ≈ ~2.0 vol) and finish carbonation cold in the keg.\n\nMatch the wort-in fitting to the CFC output for a closed, oxygen-free transfer.',
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
        key: 'glycol-setpoint',
        label: 'Glycol setpoint (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
      { key: 'vessel-rating-verified', label: 'Vessel MAWP verified', kind: 'bool' },
      { key: 'spunding-prv-checked', label: 'Spunding valve + PRV free-moving', kind: 'bool' },
    ],
    timers: [
      {
        id: 'glycol-precool',
        label: 'Glycol pre-cool',
        durationFrom: { kind: 'fixed', minutes: 30 },
      },
    ],
    safety_md:
      '⚠ **Only a pressure-rated vessel may be sealed under fermentation pressure.** Spunding valve + PRV must be clean and free-moving — never plug the PRV. Never set spunding at or above the vessel MAWP.',
  },

  // ── Step 14 ─────────────────────────────────────────────────────────────────
  {
    id: 'stage-keg-gear',
    title: 'Stage closed-transfer & keg gear',
    body_md:
      'Stage and sanitize the closed/pressure transfer line, CO2-purged destination keg(s), CO2 regulator and gas. **If nitro:** also stage the beer-gas (~75/25 or 70/30 N2/CO2) bottle, nitro regulator, and stout faucet/restrictor plate.\n\nCO2-purge each clean keg; label each keg.\n\nClosed transfer from a pressure fermenter to a purged keg keeps oxygen out — the main enemy of finished beer, especially hoppy styles.\n\n**Nitro note:** force-carbonate to low residual CO2 (~1.2–1.5 vol) with plain CO2; dispense ~30 psi beer gas through a restrictor-plate stout faucet. **Nitro 30 psi must stay in the keg — never in the 15-psi-MAWP fermenter.**',
    values: [
      {
        key: 'co2SetPsi',
        label: 'CO2 purge pressure',
        source: 'choice',
        unit: 'psi',
        precision: 0,
      },
    ],
    logs: [
      { key: 'kegs-purged-labeled', label: 'Kegs purged + labeled', kind: 'bool' },
      { key: 'line-sanitized', label: 'Transfer line + disconnects sanitized', kind: 'bool' },
      { key: 'gas-path', label: 'Gas path (CO2 / nitro)', kind: 'text' },
    ],
    timers: [],
    safety_md:
      '⚠ **Only rated kegs and fittings.** Secure cylinders upright and chained. Bleed via PRV before opening any fitting. CO2/N2 displace oxygen — ventilate the space. Nitro 30 psi must be confined to the keg (rated ≥65 psi PRV), never the 15-psi-MAWP fermenter.',
  },

  // ── Step 15 ─────────────────────────────────────────────────────────────────
  {
    id: 'prep-signoff',
    title: 'Stage 0 sign-off',
    body_md:
      'Final walk-through before committing heat. Verify all stations:\n\n- Strike water (+ salts) in the leak-tested vessel, element submerged\n- Sparge water staged and heatable\n- Grain milled and weighed, ready\n- Hops (and adjuncts if applicable) bagged and in firing order\n- Yeast prepped (or starter counted down)\n- Cold-side fully sanitized\n- Fermenter pre-cooling with spunding valve + PRV checked\n- Session live in the app\n\nOne explicit sign-off catches the forgotten item before committing heat.',
    values: [],
    logs: [{ key: 'all-stations-green', label: 'All Stage 0 stations green', kind: 'bool' }],
    timers: [],
    completeEffects: [{ t: 'stageFocus', stage: 'hotside' }],
    safety_md:
      '⚠ Last electric and pressure sanity check: element submerged, GFCI outlet confirmed, spunding valve + PRV free-moving before any heat is applied.',
  },
]

export const PREP_STAGE: ProcessStage = { id: 'prep', title: 'Prep & Mise en Place', steps }
