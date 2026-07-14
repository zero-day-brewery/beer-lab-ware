import type { ProcessStage, ProcessStep } from '../types'

const steps: ProcessStep[] = [
  // ── Step 1 ──────────────────────────────────────────────────────────────────
  {
    id: 'chill-keg-serving',
    title: 'Chill keg to serving temp',
    body_md:
      'Set the Penguin chiller to the recipe serving temp. Equilibrate for at least 4 h — overnight is better. Verify the **liquid** temperature with a probe and record it.\n\nCarbonation equilibrium is temperature-dependent — setting dispense pressure against the wrong temperature gives a flat or over-carbonated pour. The Penguin shares cooling across 4 vessels; equilibration may take longer than expected.\n\n**Serving temp targets:** CO2 ales 4–7°C; nitro 6–10°C.',
    values: [],
    logs: [
      {
        key: 'measured-serving-temp',
        label: 'Measured serving temp (°C)',
        kind: 'temp',
        unit: '°C',
        required: true,
      },
    ],
    timers: [
      {
        id: 'keg-equilibration',
        label: 'Keg temp equilibration',
        durationFrom: { kind: 'fixed', minutes: 240 },
      },
    ],
    enterEffects: [{ t: 'stageFocus', stage: 'conditioning' }],
    safety_md:
      '⚠ Glycol mains run near liquid — GFCI outlet required. Do not defeat the thermostat.',
  },

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  {
    id: 'confirm-carbonation',
    title: 'Confirm target carbonation (CO2 volumes)',
    body_md:
      'Pull the style target CO2 volume. Confirm that force-carb held set pressure long enough, or that spunding hit the target. Optionally reference the carbonation chart at actual serving temp.\n\n**Style references:** American pale ~2.5 vol; Belgian tripel ~3.0 vol; English bitter ~1.8 vol; American stout 2.0–2.4 vol; nitro 1.2–1.5 vol.\n\nSpunded CO2 is free — verify before adding more so you do not overshoot the target.',
    values: [
      {
        key: 'residualCo2_vol',
        label: 'Estimated residual CO2 (vol)',
        source: 'derived',
        precision: 1,
      },
    ],
    logs: [
      {
        key: 'target-carbonation',
        label: 'Target CO2 (vols)',
        kind: 'number',
        unit: 'vol',
        required: true,
      },
    ],
    timers: [],
  },

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  {
    id: 'co2-balanced-dispense',
    title: '[CO2] Set balanced dispense pressure',
    body_md:
      'Find the saturation pressure for your target CO2 vols at serving temp, then balance the beer line so line resistance roughly cancels applied pressure (minus a small pour-height term). **Lengthen the line rather than dropping pressure** — under-pressurising to control foam goes flat over days.\n\n**Verified values:** 2.5 vol at 5°C ≈ ~12 psi saturation. Balanced line at 12 psi with 3/16" ID tubing: real measured resistance is often ~1–1.5 psi/ft (computed lengths from 2 psi/ft run short — verify with a pour). Allow ~1 psi/ft rise for pour height.\n\nPressure settle ~15–30 min, then pull a test pour.',
    values: [
      {
        key: 'co2SetPsi',
        label: 'Regulator PSI',
        source: 'choice',
        unit: 'psi',
        precision: 0,
      },
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
      {
        key: 'line-length',
        label: 'Beer line length (ft)',
        kind: 'number',
        unit: 'ft',
      },
    ],
    timers: [
      {
        id: 'pressure-settle',
        label: 'Pressure settle',
        durationFrom: { kind: 'fixed', minutes: 20 },
      },
    ],
    branch: { t: 'carbPath', eq: 'co2' },
    safety_md:
      '⚠ Only within keg rating (working pressure ~130 psi; dispense never needs >~12–15 psi). Confirm the PRV is free-moving before pressurising.',
  },

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  {
    id: 'nitro-dispense-pressure',
    title: '[Nitro] Set nitro dispense pressure',
    body_md:
      "Switch to beer-gas (~70/30–75/25 N2/CO2) via the nitro regulator. Set dispense pressure to ~25–40 psi (typically ~30 psi at 8°C). Pour through a restrictor-plate stout faucet.\n\nKeep residual CO2 low (~1.2–1.5 vol). N2's low solubility lets high push pressure drive the cascade without over-carbonating the beer.\n\n**Beer-gas pressure is in the keg — it must never reach the 15-psi-MAWP fermenter.**",
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
        key: 'beer-gas-regulator-psi',
        label: 'Beer-gas regulator PSI',
        kind: 'number',
        unit: 'psi',
        required: true,
        targetValueKey: 'nitroDispense_psi',
      },
      {
        key: 'gas-blend',
        label: 'Gas blend (e.g. 75/25)',
        kind: 'text',
        required: true,
      },
    ],
    timers: [],
    branch: { t: 'carbPath', eq: 'nitro' },
    safety_md:
      '⚠ **Nitro 25–40 psi needs a beer-gas/high-pressure regulator and a keg PRV rated ≥65 psi — never a 17/35 psi valve, which vents inside the nitro dispense range. Beer-gas is an asphyxiant — ventilate. 30 psi IN THE KEG only; never the 15-psi-MAWP fermenter.**',
  },

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  {
    id: 'purge-first-pour',
    title: 'Purge the line & pull the first pour',
    body_md:
      'Pour off a short glass to clear any oxidised or foamy line beer, then pull the real first pour.\n\n**CO2:** open fully, pour down a tilted ~45° clean glass, then straighten. **Nitro:** handle forward through the restrictor, fill ~3/4, let the cascade settle (~1–2 min), top with the handle back.\n\nThe line\'s first beer is not representative of the batch. Correct pour technique drives foam — do not "fix" carbonation that is actually fine. Spunded, closed-transferred beer typically pours bright on the first glass; a hazy or oxidised first pour suggests a leaking post or air in the line.',
    values: [],
    logs: [
      {
        key: 'first-pour-behaviour',
        label: 'First pour — foam / head behaviour',
        kind: 'text',
      },
    ],
    timers: [
      {
        id: 'nitro-cascade',
        label: 'Nitro cascade settle',
        durationFrom: { kind: 'fixed', minutes: 2 },
      },
    ],
    safety_md:
      '⚠ The keg is pressurised — do not disconnect a post under pressure. Vent via the PRV before opening any fitting.',
  },

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  {
    id: 'evaluate-carbonation',
    title: 'Evaluate carbonation & adjust',
    body_md:
      'Judge the pour against the target. **All-foam at a balanced pressure = over-carbonated** — vent CO2 via the PRV, re-check at actual serving temp, re-wait. **Flat = under-carbonated** — raise pressure + time, or verify that the saturation pressure was set at actual serving temp.\n\nDo not drop pressure to tame foam — that de-carbonates the beer over days. Dissolved CO2 (carbonation) and dispense balance are two separate dials; fix the right one.\n\nRe-equilibration after a correction: wait ~30 min min, then re-pour and re-judge.',
    values: [],
    logs: [
      {
        key: 'carbonation-on-target',
        label: 'Carbonation hit target?',
        kind: 'bool',
        required: true,
      },
      {
        key: 'correction-applied',
        label: 'Correction applied (if any)',
        kind: 'text',
      },
    ],
    timers: [
      {
        id: 'reequilibration',
        label: 'Re-equilibration after correction',
        durationFrom: { kind: 'fixed', minutes: 30 },
      },
    ],
    safety_md:
      '⚠ **Vent only via the PRV — never crack a post under pressure. Ventilate; cold CO2 release displaces oxygen.**',
  },

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  {
    id: 'confirm-fg',
    title: 'Confirm final gravity (FG)',
    body_md:
      'If FG was not finalised during Stage 3, lock it in now. Use a temp-corrected hydrometer, or run a refractometer reading through the Sean Terrill cubic correction (alcohol skews raw Brix readings high — do not enter raw Brix as SG).\n\n**Estimated FG** from `calcFG` (OG 1.052, 76% attenuation → 1.012). **Corrected FG** from `correctedFG` helper (OG 1.052, 6.6°Bx → ~1.012 at WCF = 1.0).\n\nPull the sample via the dip-tube port under low pressure — do not fully vent the spunding CO2 or you risk oxidation.',
    values: [
      {
        key: 'correctedFG',
        label: 'Estimated FG (corrected)',
        source: 'calc',
        precision: 3,
      },
    ],
    logs: [
      {
        key: 'measured-fg',
        label: 'Measured FG (corrected)',
        kind: 'gravity',
        required: true,
        targetValueKey: 'correctedFG',
      },
    ],
    timers: [],
  },

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  {
    id: 'compute-abv',
    title: 'Compute final ABV',
    body_md:
      'Let the app compute ABV from **measured OG + corrected FG** using the profile formula (B40pro default = simple).\n\n**Simple formula:** ABV = (OG − FG) × 131.25 — e.g. (1.052 − 1.012) × 131.25 = **5.25%**.\n\n**Advanced (Hall, Zymurgy 1995):** ABV = (76.08 × (OG − FG) / (1.775 − OG)) × (FG / 0.794). Recommended for OG < ~1.070 where divergence vs simple is meaningful; diverges > 0.2% at very high OG.\n\nABV is the label number — compute from measured values, not predicted targets.',
    values: [
      {
        key: 'finalABV',
        label: 'Final ABV',
        source: 'derived',
        unit: '%',
        precision: 2,
      },
    ],
    logs: [
      {
        key: 'final-abv',
        label: 'Final ABV (%)',
        kind: 'number',
        unit: '%',
        required: true,
        targetValueKey: 'finalABV',
      },
    ],
    timers: [],
  },

  // ── Step 9 ──────────────────────────────────────────────────────────────────
  {
    id: 'compute-efficiency',
    title: 'Compute final brewhouse efficiency',
    body_md:
      "Efficiency = collected gravity points ÷ max potential points × 100. Compare to the profile's 72% seed to calibrate future recipes.\n\n**Example:** max points = 10 lb 2-row × 37 PPG = 370. Collected = 52 pts × 5.5 gal = 286. Efficiency = 286 / 370 = **77.3%** — update the profile if materially above or below the seed value.\n\nRIMS recirc + the sparge manifold tend to push real efficiency above the conservative 72% factory seed once the system is dialled in. Recalibrate `brewhouseEfficiency_pct` after each batch.",
    values: [
      {
        key: 'brewhouseEfficiency_pct',
        label: 'Brewhouse efficiency',
        source: 'derived',
        unit: '%',
        precision: 1,
      },
    ],
    logs: [
      {
        key: 'into-fermenter-volume',
        label: 'Into-fermenter volume (L)',
        kind: 'number',
        unit: 'L',
        required: true,
        targetValueKey: 'intoFermenter_L',
      },
      {
        key: 'final-efficiency',
        label: 'Final brewhouse efficiency (%)',
        kind: 'number',
        unit: '%',
        required: true,
        targetValueKey: 'brewhouseEfficiency_pct',
      },
    ],
    timers: [],
  },

  // ── Step 10 ─────────────────────────────────────────────────────────────────
  {
    id: 'compute-attenuation',
    title: 'Compute apparent attenuation',
    body_md:
      "Apparent degree of fermentation (ADF%) = (OG_pts − FG_pts) / OG_pts × 100. Compare to the yeast's published range.\n\n**Example:** (52 − 12) / 52 = **76.9%**. Yeast snapshot 73–80% → mid-range = healthy fermentation.\n\nLow attenuation flags under-pitch, low ferment temp, or a stuck fermentation. High attenuation flags an unexpectedly fermentable wort (over-mashed or adjuncts). Both tell you what to adjust next batch.",
    values: [
      {
        key: 'attenuationPct',
        label: 'Apparent attenuation',
        source: 'derived',
        unit: '%',
        precision: 1,
      },
    ],
    logs: [
      {
        key: 'apparent-attenuation',
        label: 'Apparent attenuation (%)',
        kind: 'number',
        unit: '%',
        required: true,
        targetValueKey: 'attenuationPct',
      },
    ],
    timers: [],
  },

  // ── Step 11 — Tasting: Aroma ─────────────────────────────────────────────────
  {
    id: 'taste-aroma',
    title: 'Tasting — Aroma',
    body_md:
      'Nose the beer fresh. Note malt character, hop aroma, esters/phenols, and any off-aromas. Key off-aromas to check: **DMS** (cooked-corn, from weak boil and/or slow covered cooling); **diacetyl** (butter/butterscotch, from incomplete diacetyl rest); **acetaldehyde** (green apple, yeast metabolite); **oxidation** (cardboard, sherry); **solvent/hot** (fusel alcohols, from high ferment temp or under-pitch).\n\nAroma is the most diagnostic tasting note — defects detected here usually explain the flavour too.\n\n**BJCP: Aroma /12.**',
    values: [],
    logs: [
      {
        key: 'aroma-notes',
        label: 'Aroma notes',
        kind: 'text',
        required: true,
      },
      {
        key: 'aroma-score',
        label: 'Aroma BJCP score (/12)',
        kind: 'number',
        unit: '/12',
      },
    ],
    timers: [],
  },

  // ── Step 12 — Tasting: Appearance ───────────────────────────────────────────
  {
    id: 'taste-appearance',
    title: 'Tasting — Appearance',
    body_md:
      'Evaluate colour vs predicted SRM (Morey formula), clarity, and head. Note head retention, bubble size, lacing.\n\n**For nitro:** look for the classic cascade (bubbles falling along the glass wall, dense white head). A cloudy pour in a style expected to be bright flags yeast carry-over or a failed cold-crash.\n\n**BJCP: Appearance /3.**',
    values: [],
    logs: [
      {
        key: 'appearance-notes',
        label: 'Appearance notes',
        kind: 'text',
        required: true,
      },
      {
        key: 'appearance-score',
        label: 'Appearance BJCP score (/3)',
        kind: 'number',
        unit: '/3',
      },
    ],
    timers: [],
  },

  // ── Step 13 — Tasting: Flavor ────────────────────────────────────────────────
  {
    id: 'taste-flavor',
    title: 'Tasting — Flavor',
    body_md:
      'Evaluate flavour vs predicted IBU (Tinseth). Note malt/hop balance, bitterness character (harsh vs clean), finish (dry/sweet), and any off-flavours.\n\n**Key off-flavours:** astringency (over-sparge or mash/sparge pH > ~5.8 — the dominant tannin driver); diacetyl (incomplete rest); acetaldehyde (green apple); oxidation; DMS (cooked-corn).\n\n**BJCP: Flavor /20.**',
    values: [],
    logs: [
      {
        key: 'flavor-notes',
        label: 'Flavor notes',
        kind: 'text',
        required: true,
      },
      {
        key: 'flavor-score',
        label: 'Flavor BJCP score (/20)',
        kind: 'number',
        unit: '/20',
      },
    ],
    timers: [],
  },

  // ── Step 14 — Tasting: Mouthfeel ─────────────────────────────────────────────
  {
    id: 'taste-mouthfeel',
    title: 'Tasting — Mouthfeel',
    body_md:
      'Evaluate body, carbonation feel, warmth, and for nitro — creaminess.\n\n**Carbonation feel at 2.5 vol:** lively, fine bubbles. **Nitro:** soft, creamy, low fizz with a dense head cascade. **Body** reflects attenuation + adjuncts: high attenuation = dry; residual dextrins = fuller. Warmth (fusel alcohol feel) flags high ferment temp or under-pitch.\n\n**BJCP: Mouthfeel /5.**',
    values: [],
    logs: [
      {
        key: 'mouthfeel-notes',
        label: 'Mouthfeel notes',
        kind: 'text',
        required: true,
      },
      {
        key: 'mouthfeel-score',
        label: 'Mouthfeel BJCP score (/5)',
        kind: 'number',
        unit: '/5',
      },
    ],
    timers: [],
  },

  // ── Step 15 — Tasting: Overall ───────────────────────────────────────────────
  {
    id: 'taste-overall',
    title: 'Tasting — Overall impression',
    body_md:
      'Give the overall impression and a rebrew verdict. Optionally record a BJCP total score (sum of aroma + appearance + flavor + mouthfeel + overall).\n\n**BJCP overall /10 scale:** Outstanding 45–50 total; Excellent 38–44; Very Good 30–37; Good 21–29; Fair 14–20; Problematic 0–13.\n\nBJCP scoring is optional — free-form notes alone are valid.',
    values: [],
    logs: [
      {
        key: 'overall-notes',
        label: 'Overall impression',
        kind: 'text',
        required: true,
      },
      {
        key: 'overall-score',
        label: 'Overall BJCP score (/10)',
        kind: 'number',
        unit: '/10',
      },
      {
        key: 'bjcp-total',
        label: 'BJCP total (/50)',
        kind: 'number',
        unit: '/50',
      },
    ],
    timers: [],
  },

  // ── Step 16 ─────────────────────────────────────────────────────────────────
  {
    id: 'record-outcome',
    title: 'Record batch outcome & next-time changes',
    body_md:
      'Record the verdict vs target OG/FG/ABV/IBU/SRM + style. Capture specific deltas: efficiency vs assumed, attenuation vs expected, off-flavours + root cause, carb tweaks. List concrete changes for next time.\n\n**Vague notes are worthless — this is the learning loop.** The app auto-fills target-vs-actual deltas from logged values. Write one concrete "change next brew" per issue found.\n\nExamples: "lower sparge to 20 L — hit 79% efficiency, ran high"; "diacetyl detected — extend rest by 48 h"; "astringency — check sparge pH next batch".',
    values: [],
    logs: [
      {
        key: 'outcome-summary',
        label: 'Outcome summary',
        kind: 'text',
        required: true,
      },
      {
        key: 'change-next-time',
        label: 'Change-next-time list',
        kind: 'text',
      },
    ],
    timers: [],
  },

  // ── Step 17 ─────────────────────────────────────────────────────────────────
  {
    id: 'archive-batch',
    title: 'Archive the session to the Batch logbook',
    body_md:
      'Snapshot the recipe-as-brewed + all measured values + tasting notes + outcome into a persistent Batch record (Dexie logbook). Confirm the entry appears in `/logbook`.\n\nDeep-copied snapshots stay accurate even if the recipe is later edited. The archive is the source of truth for trend analysis. The board stations clear once the batch is archived; the fermenter slot returns to "Available".',
    values: [],
    logs: [
      {
        key: 'archive-confirmed',
        label: 'Batch archived to logbook',
        kind: 'bool',
        required: true,
      },
    ],
    timers: [],
    completeEffects: [{ t: 'endSession' }],
  },

  // ── Step 18 ─────────────────────────────────────────────────────────────────
  {
    id: 'review-trends',
    title: 'Review trends & close',
    body_md:
      'View efficiency over time, attenuation by yeast strain, ABV vs target, and recurring themes across batches. Carry any recalibration into the B40 Pro equipment profile before closing.\n\n**Example:** last 5 efficiencies 74/76/77/75/77 → set profile `brewhouseEfficiency_pct` to 76. Similarly update `grainAbsorption_LperKg` and `evaporationRate_LperHr` from measured batch data.\n\nTrends tell the truth single batches cannot — only recalibrate on 3+ batches for statistical confidence.',
    values: [],
    logs: [
      {
        key: 'profile-recalibration',
        label: 'Equipment profile recalibration applied?',
        kind: 'bool',
      },
    ],
    timers: [],
  },
]

export const CONDITIONING_STAGE: ProcessStage = {
  id: 'conditioning',
  title: 'Conditioning, Tasting & Review',
  steps,
}
