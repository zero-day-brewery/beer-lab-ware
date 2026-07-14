import type { ProcessStage, ProcessStep, TimerSpec } from '../types'

const boilMaster: TimerSpec = {
  id: 'boil-master',
  label: 'Boil timer',
  durationFrom: { kind: 'recipe', path: 'boilTime_min' },
  isBoilMaster: true,
}

const steps: ProcessStep[] = [
  // ── Step 1 ──────────────────────────────────────────────────────────────────
  {
    id: 'hotside-preflight',
    title: 'Pre-flight: ground, fill, confirm water plan',
    body_md:
      'Level a dry surface, plug into a dedicated **GFCI** outlet, confirm the element is fully submerged before power. Open the Brew Flow board + water gate, pick the recipe + source, add gate salts to strike water, then fill total water (or mash now and hold sparge water heated separately).\n\nSingle vessel — strike + sparge both come from this kettle. Trubinator dead space (2.0 L) is already in `calcVolumes`. Calcium present before mash aids enzymatic rest.',
    values: [
      { key: 'mashWater_L', label: 'Strike water', source: 'calc', unit: 'L', precision: 1 },
      { key: 'spargeWater_L', label: 'Sparge water', source: 'calc', unit: 'L', precision: 1 },
      { key: 'salts', label: 'Gate salts', source: 'water' },
    ],
    logs: [
      { key: 'water-source', label: 'Water source', kind: 'text' },
      { key: 'salts-added', label: 'Salts added', kind: 'bool', required: true },
      {
        key: 'total-water',
        label: 'Total water in vessel (L)',
        kind: 'number',
        unit: 'L',
        required: true,
      },
    ],
    timers: [],
    enterEffects: [{ t: 'stageFocus', stage: 'hotside' }],
    safety_md:
      '⚠ GFCI outlet required; dry plugs and controller at all times. Inspect the power cord before use.',
  },

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  {
    id: 'heat-strike-water',
    title: 'Heat strike water to strike temp',
    body_md:
      'Malt pipe seated, manifold positioned. Set the controller to **strike temp** (hotter than mash rest temp to compensate for heat absorbed by grain). Brief recirc at low flow to even temperature stratification — do not run the pump hard with no grain bed.\n\nExpect ~1–3°C overshoot; approach and settle before doughing in. Prep grain during heat-up.',
    values: [
      { key: 'strikeTemp_C', label: 'Strike temp', source: 'calc', unit: '°C', precision: 1 },
      { key: 'mashWater_L', label: 'Strike volume', source: 'calc', unit: 'L', precision: 1 },
    ],
    logs: [
      {
        key: 'strike-temp-reached',
        label: 'Strike temp reached (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        targetValueKey: 'strikeTemp_C',
      },
    ],
    timers: [
      {
        id: 'strike-heat',
        label: 'Strike heat-up',
        durationFrom: { kind: 'fixed', minutes: 25 },
      },
    ],
    enterEffects: [{ t: 'station', station: 'brew', to: 'active' }],
    safety_md:
      '⚠ Scalding water and live 3.2 kW element — dry hands at all times; no metal near terminals.',
  },

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  {
    id: 'dough-in',
    title: 'Dough in to the malt pipe',
    body_md:
      'Stop the pump, add grain slowly while stirring to break up dough balls. Seat the pipe, fit the manifold so the return sprinkles evenly, keep grain below the water line, and verify mash temp after settling.\n\nAdd grain to water (not water to grain) to reduce clumping. Max grist ~9 kg.',
    values: [
      { key: 'fermentable', label: 'Mashed grain bill', source: 'recipe' },
      {
        key: 'mashStepTemp_C',
        label: 'Target rest temp',
        source: 'calc',
        unit: '°C',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'actual-mash-temp',
        label: 'Actual mash temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        targetValueKey: 'mashStepTemp_C',
      },
      {
        key: 'mash-ph',
        label: 'Measured mash pH',
        kind: 'number',
        required: true,
        targetValueKey: 'estMashPh',
      },
    ],
    timers: [],
    safety_md:
      '⚠ Scalding water and steam — use heat-resistant gloves; move slowly around the vessel.',
  },

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  {
    id: 'mash-rest',
    title: 'Run the mash rest with recirculation',
    body_md:
      'Gentle pump draws wort through the grain bed and returns it over the top (continuous vorlauf + RIMS temp control). Hold rest temp for the full duration. If flow slows or the pump cavitates, back off the flow rate and gently rake.\n\nRecirc keeps temperature uniform and clarifies the wort. A compacted bed scorches stagnant wort while the bed itself stays cold — confirm flow before walking away.\n\nInsulation jacket holds temp; the element only heats flowing wort. Optional iodine test ~10 min before end to confirm full conversion.',
    values: [
      {
        key: 'mashStepTemp_C',
        label: 'Rest temp',
        source: 'recipe',
        index: 0,
        unit: '°C',
        precision: 0,
      },
      {
        key: 'mashStepTime_min',
        label: 'Rest duration',
        source: 'recipe',
        index: 0,
        unit: 'min',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'mash-temp-held',
        label: 'Mash temp held (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        targetValueKey: 'mashStepTemp_C',
      },
      { key: 'recirc-flowing', label: 'Recirc flowing', kind: 'bool' },
    ],
    timers: [
      {
        id: 'mash-rest',
        label: 'Mash rest',
        durationFrom: { kind: 'mashStep', index: 0 },
      },
    ],
    safety_md:
      '⚠ Hot hoses and manifold throughout. Lift the Steam Hat slowly and away from your face.',
  },

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  {
    id: 'ramp-next-step',
    title: 'Ramp to next mash step',
    body_md:
      'Raise the controller setpoint; element + recirc ramp the bed. Temperature-type steps (the normal B40 path) need no infusion — `calcStepInfusions` returns null for those. Explicit infusion-type steps get a computed boiling-water volume.\n\nRamp gently to avoid scorching. 100°C infusion water must be poured carefully when required.',
    values: [
      {
        key: 'mashStepTemp_C',
        label: 'Step temp',
        source: 'recipe',
        index: 1,
        unit: '°C',
        precision: 0,
      },
      {
        key: 'mashStepTime_min',
        label: 'Step time',
        source: 'recipe',
        index: 1,
        unit: 'min',
        precision: 0,
      },
      {
        key: 'stepInfusionWater_L',
        label: 'Infusion water (if applicable)',
        source: 'calc',
        unit: 'L',
        precision: 2,
      },
    ],
    logs: [
      {
        key: 'step-temp',
        label: 'Step temp reached (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        targetValueKey: 'mashStepTemp_C',
      },
      { key: 'ramp-time', label: 'Ramp time (min)', kind: 'time', unit: 'min', required: true },
    ],
    timers: [
      {
        id: 'step-ramp',
        label: 'Step rest',
        durationFrom: { kind: 'mashStep', index: 1 },
      },
    ],
    branch: { t: 'stepMash' },
    safety_md:
      '⚠ Heavier element load during ramp; 100°C infusion water (if used) — pour slowly and away from your body.',
  },

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  {
    id: 'mash-out',
    title: 'Mash-out',
    body_md:
      'Raise the controller to ~76–77°C and hold briefly with recirc running to halt enzymes and thin the wort before lifting the basket.\n\nFixes fermentability and eases the lauter. **Do not exceed ~78°C** (tannin/astringency threshold); keep mash/sparge pH < ~5.8 — pH is the dominant tannin driver.',
    values: [
      {
        key: 'mashStepTemp_C',
        label: 'Mash-out temp',
        source: 'recipe',
        index: 'last' as const,
        unit: '°C',
        precision: 0,
      },
      {
        key: 'mashStepTime_min',
        label: 'Hold time',
        source: 'recipe',
        index: 'last' as const,
        unit: 'min',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'mashout-temp',
        label: 'Mash-out temp reached (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
        targetValueKey: 'mashStepTemp_C',
      },
    ],
    timers: [
      {
        id: 'mashout-hold',
        label: 'Mash-out hold',
        durationFrom: { kind: 'fixed', minutes: 10 },
      },
    ],
    branch: { t: 'hasMashOut' },
    safety_md:
      '⚠ Wort near 77°C — severe scald risk at this and the next step. Heat gloves required. **Do not exceed ~78°C; keep pH < ~5.8 to avoid tannin extraction.**',
  },

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  {
    id: 'lift-drain-pipe',
    title: 'Lift & drain the malt pipe',
    body_md:
      'Stop the pump. Using the handles (+ a second person or hoist if needed), slowly lift the malt pipe to its drain/rest position above the kettle. Let it gravity-drain — **do not squeeze hard.**\n\nControlled drain recovers wort; over-squeezing pulls tannins and husk compounds. Park the pipe on its lift-rest.\n\nGrain absorption loss: ~1.0 L/kg (5.0 kg → ~5.0 L) — recalibrate this after batch #1 (typical drained basket is closer to ~0.8 L/kg).',
    values: [
      {
        key: 'grainAbsorption_LperKg',
        label: 'Grain absorption',
        source: 'equipment',
        unit: 'L/kg',
        precision: 1,
      },
    ],
    logs: [{ key: 'drain-clear', label: 'Drain clear (flow slowed)', kind: 'bool' }],
    timers: [
      {
        id: 'gravity-drain',
        label: 'Gravity drain',
        durationFrom: { kind: 'fixed', minutes: 10 },
      },
    ],
    safety_md:
      '⚠ **CRITICAL LIFT HAZARD — a full malt pipe is ~8–15 kg of hot saturated grain dripping ~77°C wort. Lift with legs, not your back; wear heat gloves; never lift the pipe over your torso or face.**',
  },

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  {
    id: 'sparge-bed',
    title: 'Sparge the lifted bed',
    body_md:
      'Distribute heated sparge water (~76°C) over the bed via the Sparge Manifold S (260 mm) + Nozzle (0.64 L/min). Apply in thin layers with no channeling, until the kettle reaches pre-boil volume. Stop at the calculated volume — over-sparging extracts tannins.\n\nNever exceed ~78°C sparge water and keep sparge wort pH < ~5.8. Sparge time ~10–20 min.',
    values: [
      { key: 'spargeWater_L', label: 'Sparge water', source: 'calc', unit: 'L', precision: 1 },
      {
        key: 'preBoilVolume_L',
        label: 'Stop at pre-boil volume',
        source: 'calc',
        unit: 'L',
        precision: 1,
      },
    ],
    logs: [
      {
        key: 'sparge-used',
        label: 'Sparge water used (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'spargeWater_L',
      },
      {
        key: 'sparge-temp',
        label: 'Sparge water temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
    ],
    timers: [],
    branch: { t: 'not', of: { t: 'noSparge' } },
    safety_md:
      '⚠ ~77°C sparge water and scalding wort — heat gloves required. **Never exceed ~78°C and keep pH < ~5.8 to avoid tannin/astringency.**',
  },

  // ── Step 9 ──────────────────────────────────────────────────────────────────
  {
    id: 'measure-preboil',
    title: 'Measure pre-boil gravity & volume',
    body_md:
      'Stir the kettle, draw a sample, cool it (or use a refractometer with ATC). Read pre-boil gravity + volume and compare to expected.\n\nPre-boil gravity × volume = points actually extracted — the only clean opportunity to correct OG before the boil (extend boil time / add DME if below target).\n\n°P/Brix toggle + refractometer correction are supported. Steam Hat keeps boil-off ~1 L/hr — do not over-collect.',
    values: [
      {
        key: 'preBoilVolume_L',
        label: 'Expected pre-boil volume',
        source: 'calc',
        unit: 'L',
        precision: 1,
      },
    ],
    logs: [
      {
        key: 'preboil-gravity',
        label: 'Pre-boil gravity',
        kind: 'gravity',
        required: true,
      },
      {
        key: 'preboil-volume',
        label: 'Pre-boil volume (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'preBoilVolume_L',
      },
    ],
    timers: [],
    safety_md:
      '⚠ Cool the wort sample before using a hydrometer — do not dip a glass hydrometer in near-boiling wort.',
  },

  // ── Step 10 ─────────────────────────────────────────────────────────────────
  {
    id: 'ramp-to-boil',
    title: 'Ramp to a rolling boil',
    body_md:
      'Remove the malt pipe, set the element to full power. Watch the hot-break/boil-over window — keep a spray bottle or be ready to cut power. Start the boil timer the moment a steady rolling boil is established. Vent the Steam Hat (do not fully seal — DMS must escape, especially with Pilsner malt).\n\nA vigorous boil drives isomerization, hot-break coagulation, and DMS removal. Steam Hat cuts boil-off to ~1 L/hr (already in `calcVolumes`).',
    values: [],
    logs: [{ key: 'time-to-boil', label: 'Time to rolling boil (min)', kind: 'time', unit: 'min' }],
    timers: [boilMaster],
    enterEffects: [{ t: 'station', station: 'brew', to: 'active' }],
    safety_md:
      '⚠ **CRITICAL — boil-over + scald at hot break; live 3.2 kW element; 100°C steam — vent Steam Hat away from face and body; never seal the lid.**',
  },

  // ── Step 11 ─────────────────────────────────────────────────────────────────
  {
    id: 'boil-additions',
    title: 'Fire timed hop / Whirlfloc / adjunct additions',
    body_md:
      'Add each hop, Whirlfloc, or kettle adjunct at its scheduled minutes-remaining. Typical schedule: bittering ~60 min, flavor 15–20 min, aroma 5–0 min, Whirlfloc ~15 min, kettle sugars late.\n\nIBU depends on boil time (Tinseth on average boil gravity + post-boil volume); a missed addition changes balance. Add hops slowly — pellets can nucleate a boil-over. Trubinator/hop spider recommended for heavy late charges.\n\nSteam Hat retains heat on late additions — trust the app Tinseth number.',
    values: [
      { key: 'hop', label: 'Hop additions', source: 'recipe' },
      { key: 'targetIBU', label: 'Expected total IBU (Tinseth)', source: 'calc', precision: 0 },
      { key: 'misc', label: 'Kettle misc / finings', source: 'recipe' },
    ],
    logs: [
      {
        key: 'additions-fired',
        label: 'Each addition fired on time',
        kind: 'bool',
        required: true,
      },
    ],
    timers: [],
    safety_md:
      '⚠ Pellet hops can nucleate a violent boil-over — add slowly and be ready to cut power or spray.',
  },

  // ── Step 12 ─────────────────────────────────────────────────────────────────
  {
    id: 'whirlpool-hopstand',
    title: 'Flameout, whirlpool & hop-stand',
    body_md:
      'Cut the element at flameout, add whirlpool hops, run the recirc pump (or stir manually) to create a whirlpool, then hold the stand at the chosen temp (e.g. cool to ~80°C to favour aroma).\n\nThe whirlpool cones trub for a cleaner transfer; a hop-stand extracts aroma with less bitterness (some IBU still modelled). Let the cone settle a few minutes before pumping so the pickup draws clear wort and spares the CFC passages.\n\nOptionally cool-to-temp then add late aroma hops.',
    values: [{ key: 'hop', label: 'Whirlpool hop additions', source: 'recipe' }],
    logs: [
      { key: 'whirlpool-temp', label: 'Whirlpool stand temp (°C)', kind: 'temp', unit: '°C' },
      {
        key: 'stand-duration',
        label: 'Stand duration (min)',
        kind: 'time',
        unit: 'min',
        required: true,
      },
    ],
    timers: [],
    branch: { t: 'hasWhirlpool' },
    safety_md: '⚠ Element off but wort is ~80–100°C — treat all hoses and the vessel as scalding.',
  },

  // ── Step 13 ─────────────────────────────────────────────────────────────────
  {
    id: 'chill-cfc',
    title: 'Chill in-line through the CFC Pro',
    body_md:
      'Connect the CFC Pro between the pump outlet and the sanitized fermenter. Start coolant flowing **counter to** wort flow **before** sending any wort. Then pump wort through; throttle the flow rate so the outlet hits pitch/transfer temp.\n\nCounterflow cooling minimises hot-aeration and reaches pitch temp fast. Flow rate sets outlet temp — slow down if the outlet runs warm. Stop transferring when the kettle is near-empty (trub cone begins to pull through).\n\nThe Penguin glycol chiller can pre-chill the coolant loop for a cold-pitch. Cooling shrinkage ~4%: postChill ≈ postBoil × 0.96.',
    values: [
      {
        key: 'coolingShrinkage_pct',
        label: 'Cooling shrinkage',
        source: 'equipment',
        unit: '%',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'cfc-outlet-temp',
        label: 'CFC outlet wort temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
      { key: 'coolant-inlet-temp', label: 'Coolant inlet temp (°C)', kind: 'temp', unit: '°C' },
    ],
    timers: [
      {
        id: 'chill-transfer',
        label: 'Chill & transfer',
        durationFrom: { kind: 'fixed', minutes: 15 },
      },
    ],
    enterEffects: [{ t: 'station', station: 'wortChiller', to: 'active' }],
    safety_md:
      '⚠ **CRITICAL — hot wort under pump pressure. Verify every TC clamp connection before starting the pump. Keep electrical and coolant separate; element must be OFF.**',
  },

  // ── Step 14 ─────────────────────────────────────────────────────────────────
  {
    id: 'measure-og-efficiency',
    title: 'Measure OG, into-fermenter volume & compute efficiency',
    body_md:
      'Read OG in the fermenter (hydrometer or EasyDens), record the volume, enter OG on the fermenter card. Compare to target OG and target into-fermenter volume, then compute actual brewhouse efficiency to calibrate the profile.\n\nOG is the definitive efficiency/ABV baseline. Actual efficiency = collected points ÷ max potential × 100; compare to the 72% profile seed and update `brewhouseEfficiency_pct` if materially different. Also recalibrate `grainAbsorption_LperKg` and `evaporationRate_LperHr` from real data.\n\nFermenter is now full and heavy — get help if needed.',
    values: [
      { key: 'targetOG', label: 'Target OG', source: 'calc', precision: 3 },
      {
        key: 'intoFermenter_L',
        label: 'Target into-fermenter',
        source: 'calc',
        unit: 'L',
        precision: 1,
      },
      {
        key: 'brewhouseEfficiency_pct',
        label: 'Profile brewhouse efficiency',
        source: 'equipment',
        unit: '%',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'og-measured',
        label: 'OG measured',
        kind: 'gravity',
        required: true,
        writesTo: { target: 'fermenter', field: 'og' },
      },
      {
        key: 'into-fermenter-volume',
        label: 'Into-fermenter volume (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'intoFermenter_L',
      },
      {
        key: 'computed-efficiency',
        label: 'Computed brewhouse efficiency (%)',
        kind: 'number',
        unit: '%',
        required: true,
        targetValueKey: 'brewhouseEfficiency_pct',
      },
    ],
    timers: [],
    completeEffects: [{ t: 'fermenter', to: 'fermenting' }],
    safety_md:
      '⚠ Cool the sample before using a hydrometer. Fermenter is full and heavy — get help moving it; no pressure until pitched and sealed (Stage 2).',
  },
]

export const HOTSIDE_STAGE: ProcessStage = { id: 'hotside', title: 'Brew Day — Hot Side', steps }
