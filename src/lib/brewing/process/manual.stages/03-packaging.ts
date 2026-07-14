import type { ProcessStage, ProcessStep } from '../types'

const steps: ProcessStep[] = [
  // ── Step 1 ──────────────────────────────────────────────────────────────────
  {
    id: 'confirm-fermentation-done',
    title: 'Confirm fermentation finished',
    body_md:
      'Verify three stable FG readings 24–48 h apart at target FG. Diacetyl rest and cold-crash must both be complete; finish any pending dry-hop charge first.\n\nPackaging an active beer over-pressurises the keg — a gusher or safety event follows. Read gravity off a pulled sample, not the spunding gauge.',
    values: [{ key: 'correctedFG', label: 'Target FG', source: 'calc', precision: 3 }],
    logs: [
      {
        key: 'stable-fg-1',
        label: 'Stable FG #1',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
      },
      {
        key: 'stable-fg-2',
        label: 'Stable FG #2',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
      },
      {
        key: 'stable-fg-3',
        label: 'Stable FG #3',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
      },
      { key: 'beer-temp', label: 'Beer temp (°C)', kind: 'temp', unit: '°C', required: true },
      { key: 'spunding-gauge', label: 'Spunding gauge reading (psi)', kind: 'number', unit: 'psi' },
    ],
    timers: [],
    enterEffects: [{ t: 'stageFocus', stage: 'packaging' }],
    safety_md:
      '⚠ Open the sample valve slowly and away from your face. Never crack a Tri-Clamp fitting under pressure — bleed first via the spunding valve.',
  },

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  {
    id: 'stage-keg-regulator-gas',
    title: 'Stage keg, regulator & gas',
    body_md:
      'Pull a ball-lock corny keg, free-move the PRV ring, and stage the CO2 regulator + cylinder (required for purge/transfer regardless of carb method). Inspect and replace post O-rings if they are flat or cracked.\n\n**If nitro:** also stage the nitro regulator, 2-way manifold, and beer-gas cylinder. Keep CO2 and nitro regulators clearly separated. Always use **plain CO2** to purge and transfer — mixed gas cannot purge O2 reliably.\n\nKeg PRV ratings: factory pull-ring PRVs vent ~55–65 psi; replacement valves come in 17/35/65/100 psi. **For nitro dispense at ~30 psi the keg PRV must be rated ≥65 psi — a 17/35 psi valve vents inside the nitro dispense range.**',
    values: [],
    logs: [
      { key: 'keg-id', label: 'Keg ID / label', kind: 'text' },
      { key: 'gas-chosen', label: 'Dispense gas (CO2 / nitro)', kind: 'text' },
      { key: 'prv-free', label: 'Keg PRV free-moving', kind: 'bool', required: true },
    ],
    timers: [],
    safety_md:
      '⚠ **CO2 and N2 are asphyxiants — ventilate the space. Secure cylinders upright and chained.** For nitro (30–40 psi) the keg PRV must be rated ≥65 psi — never a 17/35 psi valve, which vents inside the nitro range. keg PRV must be ≥65 psi for nitro, never 17/35 psi valves.',
  },

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  {
    id: 'clean-keg',
    title: 'Clean the keg',
    body_md:
      'Depressurise the keg, disassemble (posts, dip tubes, lid, PRV/poppets), scrub all surfaces in PBW or caustic solution — especially the long liquid dip tube. Rinse thoroughly until no residue or beerstone remains, then reassemble with inspected O-rings.\n\nSanitiser only works on physically clean surfaces; a clogged dip tube kills the pour. PBW soak ~20–30 min, then scrub and rinse.',
    values: [],
    logs: [{ key: 'keg-cleaned', label: 'Keg cleaned', kind: 'bool' }],
    timers: [
      {
        id: 'pbw-soak',
        label: 'PBW soak',
        durationFrom: { kind: 'fixed', minutes: 25 },
      },
    ],
    safety_md:
      '⚠ PBW/caustic is a skin and eye hazard — wear gloves and eye protection. Never mix cleaning chemistries.',
  },

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  {
    id: 'sanitize-purge-keg',
    title: 'Sanitize, then CO2-purge to O2-free state',
    body_md:
      'Fill the keg completely with no-rinse sanitiser (Star San ~1.5 mL/L). Seal, add a brief CO2 shot to seat the lid, hold contact time (~1–2 min). Then push the sanitiser **out through the liquid post** with CO2 pressure — jumper into the next keg or drain into a bucket.\n\nLiquid-displacement purging removes far more O2 than empty-keg gas cycles: matching it with gas cycling needs ~5+ cycles at ~30 psi, or 8–10 cycles at low purge pressure. Low O2 is the biggest lever on flavour stability.\n\nKeep push pressure low (~5–10 psi); foam from the sanitiser settles quickly.',
    values: [],
    logs: [
      {
        key: 'contact-time-met',
        label: 'Sanitiser contact time met',
        kind: 'bool',
        required: true,
      },
      { key: 'purged', label: 'Keg CO2-purged (liquid displacement)', kind: 'bool' },
    ],
    timers: [
      {
        id: 'sanitizer-contact',
        label: 'Sanitiser contact',
        durationFrom: { kind: 'fixed', minutes: 2 },
      },
    ],
    safety_md:
      '⚠ Keep push pressure low; sanitiser foams under pressure — vent gently. Sanitiser is acid — eye protection required.',
  },

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  {
    id: 'rig-transfer-line',
    title: 'Rig the closed / pressure transfer line',
    body_md:
      'Connect the liquid line from the FLEX+ (racking arm / floating dip tube) to the keg liquid post. Run a balance gas line from the keg gas post back to the fermenter headspace (or fit a spunding/blowtie just above transfer pressure).\n\nVerify every disconnect is fully seated before opening any valve. A closed loop means no atmosphere contact — beer never sees O2; the balance line prevents fighting back-pressure or splashing.\n\nPosition the floating dip tube above the trub cone. Fermenter head pressure (e.g. ~12 psi) vs keg ~2–4 psi gives ~8–10 psi differential for gravity-assisted flow.',
    values: [],
    logs: [
      { key: 'rig-connected', label: 'Transfer rig connected & seated', kind: 'bool' },
      {
        key: 'starting-pressure',
        label: 'Starting fermenter pressure (psi)',
        kind: 'number',
        unit: 'psi',
      },
    ],
    timers: [],
    safety_md:
      '⚠ **Seat every disconnect before opening any valve — a blown disconnect under load is a projectile and scald hazard.** Inspect every clamp and ferrule before pressurising.',
  },

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  {
    id: 'execute-closed-transfer',
    title: 'Execute the closed pressure transfer',
    body_md:
      'Slightly vent the keg (or open the balance line) to create a differential, then open the fermenter liquid valve. Beer flows under spunding head pressure — no pump, no O2 contact. Throttle gently; stop when the yeast cake is about to pull through, leaving it behind.\n\nSlow, foam-free, oxygen-free fill is the goal. Too fast causes CO2 breakout and trub carry-over. Target packaged volume = batchSize_L − fermenter dead space (B40pro 0.5 L).',
    values: [
      {
        key: 'intoFermenter_L',
        label: 'Target packaged volume',
        source: 'calc',
        unit: 'L',
        precision: 1,
      },
    ],
    logs: [
      {
        key: 'volume-transferred',
        label: 'Volume transferred (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'intoFermenter_L',
      },
    ],
    timers: [],
    safety_md:
      '⚠ Throttle flow — never exceed the keg PRV rating during transfer. Hands clear of disconnects throughout.',
  },

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  {
    id: 'seal-keg',
    title: 'Seat & pressure-seal the keg',
    body_md:
      'Disconnect transfer lines. Give a short CO2 shot (~10–15 psi), tug the PRV ring to seat it, then re-pressurise to hold the lid gasket and confirm the gauge holds steady.\n\nCorny keg lids seal by internal pressure — a held gauge confirms a good seal. A lid that will not hold must be re-seated before moving on.',
    values: [],
    logs: [{ key: 'lid-seated', label: 'Lid seated & holding pressure', kind: 'bool' }],
    timers: [],
    safety_md:
      '⚠ **Always relieve via the PRV before opening a keg later — never pry a pressurised lid.**',
  },

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  {
    id: 'determine-co2-target',
    title: 'Determine CO2 target & credit spunding residual',
    body_md:
      "Look up the style target CO2 volume, then subtract the residual CO2 the beer already holds from spunding. Residual CO2 depends on **actual crash temperature** (Henry's law), not pressure alone.\n\n**Style targets:** American ale/lager 2.4–2.7 vol; British ales 1.5–2.0 vol; German wheat 3.3–4.5 vol; American stout 2.0–2.4 vol; nitro 1.2–1.5 vol.\n\n**Residual credit:** spunding at 10 psi during warm fermentation ≈ 1.8–2.0 vol, but after cold-crashing under retained pressure the same gas can reach ~2.4–2.5 vol. Derive from crash temp + spund pressure (Henry's law). Additional force-carb needed = target − residual.",
    values: [
      {
        key: 'residualCo2_vol',
        label: 'Estimated residual CO2 (vol)',
        source: 'derived',
        precision: 1,
      },
    ],
    logs: [
      { key: 'target-vols', label: 'Target CO2 vols', kind: 'number', unit: 'vol', required: true },
      {
        key: 'estimated-residual',
        label: 'Estimated residual CO2 (vol)',
        kind: 'number',
        unit: 'vol',
      },
    ],
    timers: [],
  },

  // ── Step 9 ──────────────────────────────────────────────────────────────────
  {
    id: 'co2-set-regulator',
    title: '[CO2] Set regulator PSI for target vols at serving temp',
    body_md:
      'Find the saturation pressure that holds your target vols at serving temperature (colder = lower PSI for the same vols). Set the regulator, then connect to the keg gas post.\n\n**Verified values (CORRECTED):** 2.4 vol at 4°C ≈ **~11 psi** (not 12); 2.5 vol at 4°C ≈ ~12 psi; 2.5 vol at 12°C ≈ ~14–15 psi. This is the **carbonation set-pressure**, distinct from line/dispense pressure.\n\nCarbonation is a pressure + temperature equilibrium — always set against the actual serving temperature the keg will be held at.',
    values: [
      { key: 'co2SetPsi', label: 'Regulator PSI', source: 'choice', unit: 'psi', precision: 0 },
    ],
    logs: [
      {
        key: 'regulator-psi',
        label: 'Regulator PSI set',
        kind: 'number',
        unit: 'psi',
        required: true,
        targetValueKey: 'co2SetPsi',
      },
      { key: 'keg-temp', label: 'Keg temp (°C)', kind: 'temp', unit: '°C', required: true },
    ],
    timers: [],
    branch: { t: 'carbPath', eq: 'co2' },
    safety_md:
      '⚠ Set the regulator output **before** opening the cylinder valve. Stay well below the keg PRV rating. Never exceed the keg working pressure.',
  },

  // ── Step 10 ─────────────────────────────────────────────────────────────────
  {
    id: 'co2-set-and-wait-or-burst',
    title: '[CO2] Set-and-wait or burst / rock',
    body_md:
      '**Set-and-wait:** leave at serving PSI for ~7–14 days — foolproof, zero risk of overshoot.\n\n**Burst / rock:** raise to ~30 psi for ~24–36 h (or rock the cold keg at serving PSI), then **drop back to serving PSI immediately**. A small spunding-credit top-up is near-instant.\n\nBurst is fast but easy to overshoot — you must drop back to serving pressure after the burst window or the beer will be over-carbonated. Disconnect gas before rocking.',
    values: [
      {
        key: 'co2SetPsi',
        label: 'Carbonation set pressure',
        source: 'choice',
        unit: 'psi',
        precision: 0,
      },
    ],
    logs: [
      { key: 'carb-method', label: 'Method (set-and-wait / burst / rock)', kind: 'text' },
      { key: 'burst-psi', label: 'Burst PSI (if burst)', kind: 'number', unit: 'psi' },
    ],
    timers: [
      {
        id: 'carb-equilibration',
        label: 'Carbonation equilibration',
        durationFrom: { kind: 'fixed', minutes: 10080 },
      },
    ],
    branch: { t: 'carbPath', eq: 'co2' },
    safety_md:
      '⚠ **Drop back to serving pressure after burst — leaving at burst pressure over-carbonates the beer.** Disconnect gas before rocking the keg.',
  },

  // ── Step 11 ─────────────────────────────────────────────────────────────────
  {
    id: 'nitro-carb-low-co2',
    title: '[Nitro] Carbonate LOW with plain CO2 first',
    body_md:
      'Set dissolved CO2 deliberately low (~1.2–1.5 vol) using **plain CO2** — not beer-gas. Connect to the gas post, set the regulator to the low-CO2 setpoint, and equilibrate ~3–7 days. Switch to beer-gas only when ready to dispense.\n\n1.4 vol at 4°C ≈ ~5–6 psi CO2. The cascade character in nitro comes from N2 breakout through the restrictor, not from high carbonation.\n\n**Never use mixed beer-gas to set carbonation level — it cannot reliably hit a CO2 target.**',
    values: [],
    logs: [
      {
        key: 'nitro-co2-target',
        label: 'Nitro CO2 target (vols)',
        kind: 'number',
        unit: 'vol',
        required: true,
      },
      { key: 'co2-set-psi-nitro', label: 'CO2 set PSI', kind: 'number', unit: 'psi' },
    ],
    timers: [
      {
        id: 'nitro-co2-equilibration',
        label: 'Low-CO2 equilibration',
        durationFrom: { kind: 'fixed', minutes: 7200 },
      },
    ],
    branch: { t: 'carbPath', eq: 'nitro' },
    safety_md:
      '⚠ **Use plain CO2 only to set carbonation level — mixed beer-gas cannot hit a CO2 target.** Switch to beer-gas only for dispense.',
  },

  // ── Step 12 ─────────────────────────────────────────────────────────────────
  {
    id: 'nitro-dispense-beergas',
    title: '[Nitro] Dispense with beer gas through a stout faucet',
    body_md:
      'Switch to beer-gas (~75/25 or 70/30 N2/CO2) via the nitro regulator + 2-way manifold. Set dispense pressure to ~30 psi (range 25–35). Pour through a restrictor-plate stout faucet: fill ~3/4, let the cascade settle (~1–2 min), then top off.\n\nMostly-N2 beer-gas pushes high without over-carbonating; the restrictor plate creates the cascade. The 2-way manifold lets you run multiple nitro kegs off one cylinder.\n\n**Beer-gas pressure is in the keg (rated vessel) — it must never reach the 15-psi-MAWP fermenter.**',
    values: [
      {
        key: 'nitroDispense_psi',
        label: 'Nitro dispense pressure',
        source: 'choice',
        unit: 'psi',
        precision: 0,
      },
    ],
    logs: [
      {
        key: 'gas-blend',
        label: 'Beer-gas blend (e.g. 75/25)',
        kind: 'text',
      },
      {
        key: 'dispense-psi',
        label: 'Dispense pressure (psi)',
        kind: 'number',
        unit: 'psi',
        required: true,
        targetValueKey: 'nitroDispense_psi',
      },
    ],
    timers: [],
    branch: { t: 'carbPath', eq: 'nitro' },
    safety_md:
      '⚠ **Nitro dispense at 25–40 psi — confirm lines, clamps, and all fittings are rated above dispense pressure. Keg PRV must be ≥65 psi (not 17/35 psi). Beer-gas is an asphyxiant — ventilate.** nitro 30 psi IN THE KEG only, never the 15-psi-MAWP fermenter. keg PRV must be ≥65 psi for nitro, never 17/35 psi valves.',
  },

  // ── Step 13 ─────────────────────────────────────────────────────────────────
  {
    id: 'leak-check-keg',
    title: 'Leak-check the keg',
    body_md:
      'At carbonation or dispense pressure, apply soapy water to the lid seam, posts, PRV, and disconnects and watch for bubbles. Alternatively, mark the gauge with gas disconnected and confirm it holds overnight.\n\nA slow leak bleeds carbonation, wastes gas, and allows O2 to enter on pressure cycles. Fix any leak before walking away — replace (never plug) a leaking PRV.',
    values: [],
    logs: [
      { key: 'leak-result', label: 'Leak check result (pass / fail)', kind: 'text' },
      { key: 'pressure-held', label: 'Pressure held overnight', kind: 'bool', required: true },
    ],
    timers: [
      {
        id: 'overnight-hold',
        label: 'Overnight pressure hold',
        durationFrom: { kind: 'fixed', minutes: 720 },
      },
    ],
    safety_md:
      '⚠ Keep pressure below the PRV rating. **Replace, never plug, a leaking PRV.** A failed leak check blocks completion.',
  },

  // ── Step 14 ─────────────────────────────────────────────────────────────────
  {
    id: 'label-close-batch',
    title: 'Label & log the keg, close out the batch',
    body_md:
      'Label the keg: name, batch date, OG, FG, ABV, carb method + target vols, carb start date.\n\nLog to the app: final volume, FG, ABV, package date, keg ID, carb method + vols. Mark the batch Packaged; queue the fermenter slot for cleaning.\n\nLogging measured efficiency, attenuation, and volume replaces the B40pro factory defaults (mash 78%, brewhouse 72%, evap 1.0 L/hr) with calibrated truth for future batches.',
    values: [
      { key: 'finalABV', label: 'Final ABV', source: 'derived', unit: '%', precision: 2 },
      { key: 'correctedFG', label: 'Final FG', source: 'calc', precision: 3 },
    ],
    logs: [
      {
        key: 'og-final',
        label: 'OG (measured)',
        kind: 'gravity',
        required: true,
        writesTo: { target: 'fermenter', field: 'og' },
      },
      {
        key: 'fg-final',
        label: 'FG (measured)',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
        writesTo: { target: 'fermenter', field: 'fg' },
      },
      {
        key: 'abv-final',
        label: 'Final ABV (%)',
        kind: 'number',
        unit: '%',
        required: true,
        targetValueKey: 'finalABV',
      },
      {
        key: 'packaged-volume',
        label: 'Packaged volume (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'intoFermenter_L',
      },
      { key: 'carb-method', label: 'Carb method', kind: 'text' },
      { key: 'carb-start-date', label: 'Carb start date', kind: 'text' },
    ],
    timers: [],
    completeEffects: [{ t: 'fermenter', to: 'packaged' }],
  },
]

export const PACKAGING_STAGE: ProcessStage = {
  id: 'packaging',
  title: 'Packaging — Closed Transfer to Keg + Carbonate',
  steps,
}
