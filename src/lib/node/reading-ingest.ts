/**
 * Automatic hydrometer/sensor reading ingestion — the pure logic behind the
 * sync daemon's `POST /readings` (see `sync-server.ts`, which wraps this
 * module with auth, the write mutex, and file I/O).
 *
 * WEB BLUETOOTH REALITY CHECK (documented here, not just in docs/sensors.md,
 * so the "why HTTP-only" decision travels with the code it explains): the
 * original proposal for this feature was "Tilt via Web Bluetooth directly in
 * the PWA". A Tilt broadcasts its color + gravity/temp as an Apple iBeacon
 * manufacturer-data BLE advertisement — it is NEVER connected to, only
 * scanned. Reading a manufacturer-data advertisement from a web page requires
 * the Web Bluetooth **Scanning** API (`navigator.bluetooth.requestLEScan` +
 * `watchAdvertisements`), which is experimental and flag-gated behind
 * `chrome://flags/#enable-experimental-web-platform-features` in Chrome and
 * wholly unimplemented in Safari/WebKit (Apple has stated no intent to ship
 * Web Bluetooth at all). A shipped feature cannot depend on a flag most users
 * will never enable — so this was NOT built, and Tilt support instead reaches
 * this endpoint via TiltBridge / Tilt Pi / the Tilt app's own cloud-URL
 * logging feature, every one of which already speaks plain HTTP POST. This is
 * the architecturally honest shape of the feature: a static PWA cannot listen
 * for inbound HTTP pushes (no server, nothing to bind a port to) — the
 * always-on daemon can. That asymmetry is the paid/self-hosted tier's actual
 * value, not an arbitrary limitation.
 *
 * ADAPTERS (auto-detected from the POSTed JSON's shape — see
 * `detectAndParseIngest`), confidence noted honestly per the task brief:
 *
 *  - **iSpindel HTTP JSON** (HIGH confidence — a single, stable, widely
 *    documented firmware format). Detected by `angle` (a field with no
 *    equivalent in any other adapter) plus a `name` or `ID`. `gravity` is
 *    ambiguous by design: the iSpindel's onboard polynomial can be configured
 *    to output either SG or °Plato, and the payload carries no unit flag for
 *    it. Resolved by plausibility — see `resolveISpindelGravity`.
 *  - **"Brewfather custom stream" JSON** (HIGH confidence for the WIRE
 *    FORMAT, MEDIUM for device attribution). This is Brewfather's own
 *    documented custom-stream contract (`name`, `temp`, `temp_unit`,
 *    `gravity`, `gravity_unit`, `ph`, `comment`, `beer`) — and BOTH
 *    TiltBridge (its "Custom"/"Brewfather" HTTP target) and the iSpindel
 *    firmware's own "Brewfather" target emit EXACTLY this shape, so one
 *    adapter genuinely covers Tilt-via-TiltBridge, iSpindel-via-Brewfather-
 *    target, and any other device whose bridge already speaks this format —
 *    no new firmware config needed beyond picking an existing "Brewfather"
 *    target. A missing `temp_unit` defaults to **°C** — the contract's own
 *    documented default (docs.brewfather.app/integrations/custom-stream). An
 *    earlier draft defaulted to °F "because TiltBridge is the likeliest
 *    sender", but TiltBridge always sends an explicit `temp_unit: "F"`, so
 *    the C default costs no real sender anything. `C`/`F`/`K` are accepted;
 *    any OTHER explicit unit is a parse failure, never a silent guess.
 *    Device TYPE (source/deviceKey) is inferred from `name` — see
 *    `inferSourceFromName` — which is a heuristic, not a certainty, and is
 *    honest about that in its `warnings`.
 *  - **Tilt "native" log shape** (MEDIUM confidence) — `Color` +
 *    `SG` (int, gravity × 1000 — a documented convention several DIY Tilt
 *    receivers/PHP loggers use) + `Temp` (°F by default on stock
 *    firmware/app). Detected by the presence of `Color`, which no other
 *    adapter uses. The real Tilt app / Tilt Pi / TiltPico cloud-URL senders
 *    emit the numeric fields as JSON STRINGS (`{"Temp":"61.0","SG":"1.027"}`)
 *    — every adapter's numeric reads go through `toFiniteNumber`, which
 *    tolerates exactly that.
 *  - **RAPT Pill** — NOT implemented as a bespoke adapter. RAPT's actual
 *    cloud integration is an authenticated OAuth2 REST API the RAPT app/cloud
 *    exposes for PULLING data, not a webhook a hobbyist can point at an
 *    arbitrary URL the way Tilt/iSpindel's DIY-firmware ecosystem allows —
 *    confidence on any push/POST shape for RAPT is LOW, so per the task's own
 *    instruction ("if too uncertain, implement 'generic' instead and say
 *    so"), RAPT Pill users are pointed at the generic shape below (typically
 *    via a small community bridge/Home-Assistant automation that polls
 *    RAPT's API and re-POSTs here).
 *  - **Generic `{ deviceKey, gravity, tempC, ph?, at? }`** (the escape
 *    hatch) — for RAPT, Home Assistant, or literally any script. `gravity`
 *    is always SG here (no Plato ambiguity — this shape is OUR contract, we
 *    get to make it unambiguous).
 *
 * All adapters are marked EXPERIMENTAL in the docs: validated against
 * documented wire formats, not physical hardware (no Tilt/iSpindel/RAPT unit
 * was available to this implementation).
 *
 * NODE-ONLY: no DOM/fetch/http — pure functions over parsed JSON, easily
 * unit-tested without a running server. `sync-server.ts` is the only caller.
 */

import { v5 as uuidv5 } from 'uuid'
import { platoToSG } from '@/lib/brewing/convert/gravity'
import { fToC } from '@/lib/brewing/convert/temp'
import type { DeviceLink } from '@/lib/brewing/types/device-link'
import { type Reading, ReadingSchema, type ReadingSource } from '@/lib/brewing/types/reading'

// ── device-key normalization ────────────────────────────────────────────────

/** The 8 stock Tilt colors — the device's entire identity (one per color, no
 *  serial number). Matched case-insensitively as a SUBSTRING of whatever
 *  identity field a payload provides (`Color`, or a `name` like "Tilt Red"). */
const TILT_COLORS = ['RED', 'GREEN', 'BLACK', 'PURPLE', 'ORANGE', 'BLUE', 'YELLOW', 'PINK'] as const

function findTiltColor(raw: string): string | undefined {
  const upper = raw.trim().toUpperCase()
  return TILT_COLORS.find((c) => upper.includes(c))
}

/** `tilt:RED` — falls back to a slugified raw string when no stock color
 *  matches (a modded/relabeled Tilt still gets a stable, if unexpected, key). */
export function tiltDeviceKey(colorOrName: string): string {
  const color = findTiltColor(colorOrName)
  return `tilt:${color ?? colorOrName.trim().toUpperCase().replace(/\s+/g, '-')}`
}

/** `ispindel:iSpindel001` (or `ispindel:<numeric ID>` when no name is set). */
export function ispindelDeviceKey(nameOrId: string): string {
  return `ispindel:${nameOrId.trim()}`
}

/** `rapt:<mac-or-name>` — see module doc: reached via the generic shape today. */
export function raptDeviceKey(idOrMac: string): string {
  return `rapt:${idOrMac.trim()}`
}

/** `other:<name>` — the fallback for a Brewfather-shaped payload whose `name`
 *  doesn't identify a known device type (see `inferSourceFromName`). */
export function otherDeviceKey(name: string): string {
  return `other:${name.trim()}`
}

// ── gravity/temp resolution helpers ─────────────────────────────────────────

const PLAUSIBLE_SG_MIN = 0.98
const PLAUSIBLE_SG_MAX = 1.2

/** °Plato window for the iSpindel heuristic's Plato branch: real wort/beer
 *  sits well inside (0.5, 35] °P. Values at/below 0.5 (zero, negatives, tiny
 *  sensor noise) or above 35 are not plausible in EITHER unit — an earlier
 *  revision piped them through `platoToSG` anyway, laundering garbage (e.g.
 *  gravity 0) into a plausible-LOOKING ~1.000 SG. Now a parse failure. */
const ISPINDEL_PLATO_MIN_EXCLUSIVE = 0.5
const ISPINDEL_PLATO_MAX = 35

/**
 * iSpindel's `gravity` field is either already SG (the common calibration) or
 * °Plato (some users configure the onboard polynomial to output Plato
 * directly) — the payload carries no unit flag. Resolved by plausibility: a
 * real SG reading always falls in ~0.98–1.2; a genuine °Plato reading in that
 * SAME numeric range would be nonsensical (0.98–1.2 °P is far below any real
 * wort/beer), so a value outside the SG range is treated as °Plato and
 * converted — but ONLY when it is itself a plausible °Plato value (see
 * `ISPINDEL_PLATO_*` above). A value implausible in BOTH units fails the
 * parse outright instead of being converted into a plausible-looking SG.
 * The SG-vs-Plato choice is a HEURISTIC, not a certainty — a warning is
 * ALWAYS attached (for BOTH successful branches, not just the ambiguous one)
 * so an operator reading only the `warnings` array can always tell which
 * interpretation was chosen, and reconfigure the device to output SG directly
 * if it's wrong.
 */
function resolveISpindelGravity(
  raw: number,
  warnings: string[],
): { ok: true; sg: number } | { ok: false; reason: string } {
  if (raw >= PLAUSIBLE_SG_MIN && raw <= PLAUSIBLE_SG_MAX) {
    warnings.push(
      `gravity ${raw} is within the plausible SG range (${PLAUSIBLE_SG_MIN}-${PLAUSIBLE_SG_MAX}) — ` +
        'treated as SG directly. If your iSpindel is configured to output °Plato, reconfigure it to ' +
        'SG or expect this heuristic to guess wrong.',
    )
    return { ok: true, sg: raw }
  }
  if (raw > ISPINDEL_PLATO_MIN_EXCLUSIVE && raw <= ISPINDEL_PLATO_MAX) {
    const sg = platoToSG(raw)
    warnings.push(
      `gravity ${raw} is outside the plausible SG range (${PLAUSIBLE_SG_MIN}-${PLAUSIBLE_SG_MAX}) — ` +
        `treated as °Plato and converted to SG ${sg.toFixed(3)}. Configure the iSpindel to output SG ` +
        'directly to avoid this guess.',
    )
    return { ok: true, sg }
  }
  return {
    ok: false,
    reason:
      `gravity ${raw} is neither a plausible SG (${PLAUSIBLE_SG_MIN}-${PLAUSIBLE_SG_MAX}) nor a ` +
      `plausible °Plato (>${ISPINDEL_PLATO_MIN_EXCLUSIVE}-${ISPINDEL_PLATO_MAX}) reading — ` +
      'refusing to guess a unit for it',
  }
}

/** A real Tilt `SG` field is documented as an int, gravity × 1000 (e.g. 1042
 *  for SG 1.042) in several DIY Tilt receivers/loggers. A value ≥ 100 is
 *  unambiguously ×1000-encoded (no real SG is ever ≥ 100); anything smaller
 *  is assumed to already be decimal SG (a defensive fallback for a bridge
 *  that sends decimal despite using this shape). */
const TILT_SG_SCALE_THRESHOLD = 100
function resolveTiltNativeGravity(raw: number): number {
  return raw >= TILT_SG_SCALE_THRESHOLD ? raw / 1000 : raw
}

/** K → °C. Brewfather's custom-stream contract documents `temp_unit` as one
 *  of C/F/K — K is honored for contract completeness even though no known
 *  real sender emits it. */
const kelvinToC = (k: number): number => k - 273.15

// ── parsed-reading shape (adapter output, before device-link resolution) ───

export interface ParsedIngestReading {
  deviceKey: string
  source: ReadingSource
  deviceId?: string
  gravity?: number
  tempC?: number
  ph?: number
  /** Device-supplied timestamp (ISO), when the payload provided one. */
  at?: string
  /** Non-fatal, operator-facing notes (a plausibility guess, an unidentified
   *  device name, an unparseable `at`, …) — echoed in the 200 response body. */
  warnings: string[]
}

export type IngestParseResult =
  | { ok: true; reading: ParsedIngestReading }
  | { ok: false; reason: string }

// ── per-format adapters ─────────────────────────────────────────────────────

interface RawObject {
  [k: string]: unknown
}

/**
 * Numeric-field tolerance shared by EVERY adapter: accepts a finite number OR
 * a string that is exactly a finite decimal number ("61.0", "1027", "-3.5" —
 * surrounding whitespace tolerated). The real Tilt app / Tilt Pi / TiltPico
 * cloud-URL senders emit JSON with STRING values
 * (`{"Temp":"61.0","SG":"1.027","Color":"ORANGE"}`), so rejecting strings
 * would reject real hardware. Anything else — empty/whitespace-only strings,
 * partial numbers ("1.2.3"), hex ("0x10"), scientific notation, Infinity/NaN,
 * booleans — is `undefined`, never a coerced surprise.
 */
const DECIMAL_NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/
function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (!DECIMAL_NUMBER_RE.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/** Generic escape hatch: `{ deviceKey, gravity?, tempC?, ph?, at? }`, always
 *  SG/°C (our own contract — no unit ambiguity to resolve). Checked FIRST
 *  (most specific: an explicit `deviceKey` is never coincidentally present in
 *  any device-native payload). */
function isGenericPayload(b: RawObject): boolean {
  return isNonEmptyString(b.deviceKey)
}

function parseGeneric(b: RawObject): IngestParseResult {
  const deviceKey = (b.deviceKey as string).trim()
  const warnings: string[] = []
  const gravity = toFiniteNumber(b.gravity)
  const tempC = toFiniteNumber(b.tempC)
  const ph = toFiniteNumber(b.ph)
  let at: string | undefined
  if (isNonEmptyString(b.at)) {
    if (Number.isFinite(Date.parse(b.at))) at = new Date(b.at).toISOString()
    else warnings.push(`"at" value "${b.at}" is not a parseable timestamp — using server time.`)
  }
  if (gravity === undefined && tempC === undefined && ph === undefined) {
    return { ok: false, reason: 'generic payload has none of gravity, tempC, or ph' }
  }
  return { ok: true, reading: { deviceKey, source: 'other', gravity, tempC, ph, at, warnings } }
}

/** iSpindel HTTP JSON — detected by `angle` (unique to this format) plus a
 *  `name` or `ID` to derive identity from. */
function isISpindelPayload(b: RawObject): boolean {
  return toFiniteNumber(b.angle) !== undefined && (isNonEmptyString(b.name) || b.ID !== undefined)
}

function parseISpindel(b: RawObject): IngestParseResult {
  const name = isNonEmptyString(b.name) ? b.name.trim() : undefined
  const id = b.ID !== undefined ? String(b.ID) : undefined
  const identity = name ?? id
  if (!identity) return { ok: false, reason: 'iSpindel payload missing both name and ID' }
  const warnings: string[] = []
  let gravity: number | undefined
  const rawGravity = toFiniteNumber(b.gravity)
  if (rawGravity !== undefined) {
    const resolved = resolveISpindelGravity(rawGravity, warnings)
    if (!resolved.ok) return resolved
    gravity = resolved.sg
  }
  let tempC: number | undefined
  const rawTemp = toFiniteNumber(b.temperature)
  if (rawTemp !== undefined) {
    // Missing `temp_units` defaults to °C — the iSpindel firmware's own default.
    const unit = isNonEmptyString(b.temp_units) ? b.temp_units.trim().toUpperCase() : 'C'
    tempC = unit === 'F' ? fToC(rawTemp) : rawTemp
  }
  return {
    ok: true,
    reading: {
      deviceKey: ispindelDeviceKey(identity),
      source: 'ispindel',
      deviceId: identity,
      gravity,
      tempC,
      warnings,
    },
  }
}

/** Tilt "native" log shape — detected by `Color`, unique to this format. */
function isTiltNativePayload(b: RawObject): boolean {
  return isNonEmptyString(b.Color)
}

function parseTiltNative(b: RawObject): IngestParseResult {
  const color = (b.Color as string).trim()
  // `SG`/`Temp` arrive as JSON strings from the real Tilt app / Tilt Pi
  // cloud-URL senders (see `toFiniteNumber`); the ×1000 heuristic works on
  // the parsed value either way ("1027" → 1.027, "1.027" stays as-is).
  const rawSG = toFiniteNumber(b.SG)
  const gravity = rawSG !== undefined ? resolveTiltNativeGravity(rawSG) : undefined
  // Stock Tilt firmware/app report Temp in °F by default.
  const rawTemp = toFiniteNumber(b.Temp)
  const tempC = rawTemp !== undefined ? fToC(rawTemp) : undefined
  // Same at-least-one-measurement guard as the generic shape (see
  // `parseGeneric`) — a `Color`-only body carries no actual data to record.
  if (gravity === undefined && tempC === undefined) {
    return { ok: false, reason: 'Tilt-native payload has neither SG nor Temp' }
  }
  return {
    ok: true,
    reading: {
      deviceKey: tiltDeviceKey(color),
      source: 'tilt',
      deviceId: color,
      gravity,
      tempC,
      warnings: [],
    },
  }
}

/** Best-effort device-type inference from a Brewfather-custom-stream `name`
 *  field — see the module doc's confidence note. Never fatal: an
 *  unidentifiable name still ingests as `source: 'other'`, just with a
 *  warning attached. */
function inferSourceFromName(name: string): { source: ReadingSource; deviceKey: string } {
  const upper = name.toUpperCase()
  const tiltColor = TILT_COLORS.find((c) => upper.includes(c))
  if (tiltColor && upper.includes('TILT'))
    return { source: 'tilt', deviceKey: tiltDeviceKey(tiltColor) }
  if (upper.includes('ISPINDEL') || upper.includes('SPINDEL')) {
    return { source: 'ispindel', deviceKey: ispindelDeviceKey(name) }
  }
  if (upper.includes('RAPT') || upper.includes('PILL')) {
    return { source: 'rapt', deviceKey: raptDeviceKey(name) }
  }
  // A bare color name ("Red", "Green") with no "Tilt" qualifier is still a
  // strong enough signal in this ecosystem to call it a Tilt — but ONLY as a
  // whole word: the substring match used above (safe there, because it is
  // gated on "TILT" also appearing) would misfire here on unrelated names
  // like "Redwood Fermenter Probe". A name that IS exactly a color, or
  // contains one as its own word, stays a Tilt.
  const wholeWordColor = TILT_COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(upper))
  if (wholeWordColor) return { source: 'tilt', deviceKey: tiltDeviceKey(wholeWordColor) }
  return { source: 'other', deviceKey: otherDeviceKey(name) }
}

/** "Brewfather custom stream" shape — Brewfather's own documented contract,
 *  emitted natively by TiltBridge's "Brewfather" target AND the iSpindel
 *  firmware's "Brewfather" target alike. Detected by `name` plus at least one
 *  of `gravity`/`temp`/`ph` — checked AFTER the more distinctive iSpindel/
 *  Tilt-native shapes so a payload that also has `angle` or `Color` is
 *  claimed by the more specific adapter first. */
function isBrewfatherStreamPayload(b: RawObject): boolean {
  return (
    isNonEmptyString(b.name) &&
    (b.gravity !== undefined || b.temp !== undefined || b.ph !== undefined)
  )
}

function parseBrewfatherStream(b: RawObject): IngestParseResult {
  const name = (b.name as string).trim()
  const { source, deviceKey } = inferSourceFromName(name)
  const warnings: string[] = []
  let gravity: number | undefined
  const rawGravity = toFiniteNumber(b.gravity)
  if (rawGravity !== undefined) {
    const unit = isNonEmptyString(b.gravity_unit) ? b.gravity_unit.trim().toUpperCase() : 'G'
    gravity =
      unit === 'P' || unit === 'PLATO' || unit === 'BRIX' ? platoToSG(rawGravity) : rawGravity
  }
  let tempC: number | undefined
  const rawTemp = toFiniteNumber(b.temp)
  if (rawTemp !== undefined) {
    // Missing `temp_unit` defaults to °C — Brewfather's documented contract
    // default (see the module doc's Brewfather bullet for why NOT °F). Only
    // the contract's C/F/K are accepted; an unknown explicit unit fails the
    // parse rather than being silently mis-converted.
    const unit = isNonEmptyString(b.temp_unit) ? b.temp_unit.trim().toUpperCase() : 'C'
    if (unit === 'C') tempC = rawTemp
    else if (unit === 'F') tempC = fToC(rawTemp)
    else if (unit === 'K') tempC = kelvinToC(rawTemp)
    else {
      return {
        ok: false,
        reason: `unrecognized temp_unit "${(b.temp_unit as string).trim()}" — expected C, F, or K`,
      }
    }
  }
  const ph = toFiniteNumber(b.ph)
  // Same at-least-one-measurement guard as every other adapter (see
  // `parseGeneric`) — a name-only body carries no actual data to record.
  if (gravity === undefined && tempC === undefined && ph === undefined) {
    return { ok: false, reason: 'Brewfather-stream payload has none of temp, gravity, or ph' }
  }
  if (source === 'other') {
    warnings.push(
      `could not identify a known device type from name "${name}" — recorded as source "other". ` +
        'Rename the device to include "Tilt <color>", "iSpindel", or "RAPT" for automatic detection.',
    )
  }
  return { ok: true, reading: { deviceKey, source, deviceId: name, gravity, tempC, ph, warnings } }
}

/** Hard cap applied AFTER adapter-specific normalization, uniformly across
 *  every shape, to BOTH identity strings an adapter can emit: the normalized
 *  `deviceKey` (an attacker-controlled `name`/`deviceKey`/`Color` field could
 *  otherwise mint an arbitrarily long key that the ingest rate limiter's map
 *  would then have to track — see `createIngestRateLimiter`'s own memory
 *  bound for the other half of that defense) AND the raw `deviceId` (which is
 *  persisted verbatim onto the Reading row, then synced to and rendered by
 *  every client — an unbounded attacker-controlled string has no business in
 *  that pipeline either). 128 is generous for every real device identity
 *  documented in this module (`tilt:RED`, `ispindel:<name>`, …). */
const MAX_DEVICE_KEY_LENGTH = 128

/** Plausibility bounds applied to the FINAL, already-unit-resolved reading —
 *  independent of, and in addition to, any per-adapter SG-vs-Plato/°F-vs-°C
 *  guess above. A value outside these is never a real fermentation reading
 *  (or is a unit-resolution gone wrong), so it's rejected outright rather
 *  than silently poisoning a batch sheet/chart. */
const MIN_PLAUSIBLE_GRAVITY_SG = 0.9
const MAX_PLAUSIBLE_GRAVITY_SG = 1.2
const MIN_PLAUSIBLE_TEMP_C = -10
const MAX_PLAUSIBLE_TEMP_C = 110
/** pH is bounded (0, 14] — exclusive at 0: no fermentation sits at the
 *  theoretical extreme, and 0/negative values are overwhelmingly a sensor or
 *  encoding fault, not chemistry. Applied wherever `ph` is accepted (the
 *  generic shape AND the Brewfather stream's documented `ph` field). */
const MIN_PLAUSIBLE_PH_EXCLUSIVE = 0
const MAX_PLAUSIBLE_PH = 14

/** Final cross-adapter guard: deviceKey/deviceId length + gravity/tempC/ph
 *  plausibility bounds, applied to every adapter's output uniformly (see the
 *  constants above for why each exists). Runs AFTER adapter-specific
 *  parsing/unit resolution succeeds — an adapter-level rejection (e.g. "no
 *  measurements at all") is returned as-is, never reaching here. */
function applyIngestGuards(result: IngestParseResult): IngestParseResult {
  if (!result.ok) return result
  const { reading } = result
  if (reading.deviceKey.length > MAX_DEVICE_KEY_LENGTH) {
    return { ok: false, reason: `deviceKey exceeds ${MAX_DEVICE_KEY_LENGTH} characters` }
  }
  if (reading.deviceId !== undefined && reading.deviceId.length > MAX_DEVICE_KEY_LENGTH) {
    return { ok: false, reason: `deviceId exceeds ${MAX_DEVICE_KEY_LENGTH} characters` }
  }
  if (
    reading.gravity !== undefined &&
    (reading.gravity < MIN_PLAUSIBLE_GRAVITY_SG || reading.gravity > MAX_PLAUSIBLE_GRAVITY_SG)
  ) {
    return {
      ok: false,
      reason:
        `gravity ${reading.gravity} SG is outside the plausible range ` +
        `(${MIN_PLAUSIBLE_GRAVITY_SG}-${MAX_PLAUSIBLE_GRAVITY_SG})`,
    }
  }
  if (
    reading.tempC !== undefined &&
    (reading.tempC < MIN_PLAUSIBLE_TEMP_C || reading.tempC > MAX_PLAUSIBLE_TEMP_C)
  ) {
    return {
      ok: false,
      reason:
        `tempC ${reading.tempC} is outside the plausible range ` +
        `(${MIN_PLAUSIBLE_TEMP_C}-${MAX_PLAUSIBLE_TEMP_C})`,
    }
  }
  if (
    reading.ph !== undefined &&
    (reading.ph <= MIN_PLAUSIBLE_PH_EXCLUSIVE || reading.ph > MAX_PLAUSIBLE_PH)
  ) {
    return {
      ok: false,
      reason:
        `ph ${reading.ph} is outside the plausible range ` +
        `(${MIN_PLAUSIBLE_PH_EXCLUSIVE}, ${MAX_PLAUSIBLE_PH}]`,
    }
  }
  return result
}

/**
 * Auto-detect + parse the POSTed device payload. Order matters: most-specific
 * shapes are tried first (generic's explicit `deviceKey`, then iSpindel's
 * `angle`, then Tilt-native's `Color`) so a payload that could ambiguously
 * match more than one adapter is claimed by the most certain one; the
 * Brewfather-custom-stream shape (the least distinctive — just `name` +
 * `gravity`/`temp`/`ph`) is tried last. Every adapter's successful result
 * passes through `applyIngestGuards` (deviceKey/deviceId length,
 * gravity/tempC/ph plausibility) before being returned.
 */
export function detectAndParseIngest(body: unknown): IngestParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'payload must be a JSON object' }
  }
  const b = body as RawObject
  if (isGenericPayload(b)) return applyIngestGuards(parseGeneric(b))
  if (isISpindelPayload(b)) return applyIngestGuards(parseISpindel(b))
  if (isTiltNativePayload(b)) return applyIngestGuards(parseTiltNative(b))
  if (isBrewfatherStreamPayload(b)) return applyIngestGuards(parseBrewfatherStream(b))
  return {
    ok: false,
    reason:
      'unrecognized device payload shape — see docs/sensors.md for supported formats, or use the ' +
      'generic { deviceKey, gravity, tempC, ph?, at? } shape',
  }
}

// ── content-addressed id (dedupe re-posts) ──────────────────────────────────

/**
 * Fixed namespace UUID for sensor-ingest reading ids (RFC 4122 v5,
 * name-based). Minted once (2026-07-17) and FROZEN — changing it would break
 * re-post dedupe for every reading already recorded. Mirrors the Brewfather
 * importer's `BREWFATHER_NAMESPACE` convention (`brewfather/ids.ts`); not
 * shared with it or any other subsystem.
 */
const SENSOR_INGEST_NAMESPACE = 'c5ac8cb3-b200-408b-a0de-71b0431aba7d'

/**
 * Deterministic reading id: the SAME `deviceKey` + resolved `at` + gravity/
 * temp/ph always yields the SAME uuid, so a device retrying an identical POST
 * (network hiccup, firmware retry loop) upserts in place instead of creating
 * a duplicate row — see `upsertReading`. A genuinely NEW reading (different
 * value or a later `at`) always mints a new id.
 *
 * HONEST CAVEAT: "resolved `at`" is the device-supplied timestamp WHEN THE
 * PAYLOAD CARRIES ONE — only the generic shape does (`{ deviceKey, ..., at?
 * }`, our own contract). NONE of the three device-native adapters (iSpindel,
 * Tilt-native, Brewfather-stream) parse a payload timestamp at all, so their
 * `at` is always the SERVER's `now()` at request time (see
 * `linkAndBuildReading` below) — a retry of the SAME device-native POST a few
 * seconds later gets a DIFFERENT `at`, hence a DIFFERENT id, hence a genuinely
 * NEW row, not an upsert. Dedupe is real and load-bearing for the generic
 * shape; for the three device-native shapes it is NOT — the per-device rate
 * limit (`createIngestRateLimiter`, `SYNC_INGEST_MIN_INTERVAL_S`) is the
 * actual, practical guard against a retry storm from those devices, not this
 * id. See `docs/sensors.md` for the same caveat spelled out for operators,
 * and `tests/unit/node/sync-server.test.ts`'s device-native retry test for
 * this behavior locked in as a passing assertion, not a hazard.
 */
function ingestReadingId(
  deviceKey: string,
  at: string,
  gravity: number | undefined,
  tempC: number | undefined,
  ph: number | undefined,
): string {
  const name = `${deviceKey}:${at}:${gravity ?? ''}:${tempC ?? ''}:${ph ?? ''}`
  return uuidv5(name, SENSOR_INGEST_NAMESPACE)
}

/** Upsert-by-id into a readings array: a re-post with the SAME derived id
 *  (see `ingestReadingId`) replaces the existing row in place rather than
 *  appending a duplicate. */
function upsertReading(readings: readonly Reading[], reading: Reading): Reading[] {
  const idx = readings.findIndex((r) => r.id === reading.id)
  if (idx < 0) return [...readings, reading]
  const next = [...readings]
  next[idx] = reading
  return next
}

// ── device-link resolution + reading construction ──────────────────────────

export type IngestOutcome =
  | { status: 'linked'; deviceKey: string; batchId: string; reading: Reading; warnings: string[] }
  | { status: 'unlinked'; deviceKey: string }

export interface ApplyIngestResult {
  outcome: IngestOutcome
  /** The readings array to persist. Reference-equal to the input when
   *  `outcome.status === 'unlinked'` — nothing changed, nothing to persist. */
  nextReadings: Reading[]
}

/**
 * Resolve an already-parsed reading against the current `deviceLinks`, and —
 * only when linked — build + upsert the `Reading` row. No link for
 * `parsed.deviceKey` ⇒ `status: 'unlinked'` and `nextReadings` is the
 * UNCHANGED input (by design: the app has no batch-less reading view, so an
 * orphan pool would just be silent data nobody sees — see the module's sister
 * doc in `docs/sensors.md` for the full "why 202, not a queue" rationale).
 */
export function linkAndBuildReading(
  parsed: ParsedIngestReading,
  deviceLinks: readonly DeviceLink[],
  readings: readonly Reading[],
  now: () => Date = () => new Date(),
): ApplyIngestResult {
  // Duplicate links for one deviceKey CAN exist: the table is LWW-merged
  // across devices and deliberately not unique-indexed (see `device-link.ts`),
  // so two replicas assigning the same device offline merge into two live
  // rows. `Array.find` would silently pick whichever duplicate happened to
  // sort first — deterministic instead: the most recently updated link wins
  // (the user's latest assignment; ISO timestamps compare lexicographically),
  // tie-broken by lowest `id` so every replica resolves the same duplicate
  // set to the same batch.
  const link = deviceLinks.reduce<DeviceLink | undefined>((best, l) => {
    if (l.deviceKey !== parsed.deviceKey) return best
    if (!best) return l
    if (l.updatedAt !== best.updatedAt) return l.updatedAt > best.updatedAt ? l : best
    return l.id < best.id ? l : best
  }, undefined)
  if (!link) {
    return {
      outcome: { status: 'unlinked', deviceKey: parsed.deviceKey },
      nextReadings: readings as Reading[],
    }
  }
  const at = parsed.at ?? now().toISOString()
  const id = ingestReadingId(parsed.deviceKey, at, parsed.gravity, parsed.tempC, parsed.ph)
  const reading = ReadingSchema.parse({
    id,
    batchId: link.batchId,
    at,
    gravity: parsed.gravity,
    tempC: parsed.tempC,
    ph: parsed.ph,
    source: parsed.source,
    deviceId: parsed.deviceId,
    schemaVersion: 1,
  })
  return {
    outcome: {
      status: 'linked',
      deviceKey: parsed.deviceKey,
      batchId: link.batchId,
      reading,
      warnings: parsed.warnings,
    },
    nextReadings: upsertReading(readings, reading),
  }
}

/** Convenience wrapper: detect + parse the raw body, then resolve/build in
 *  one call. `sync-server.ts` calls the two halves separately instead (it
 *  needs the parsed `deviceKey` for rate-limiting BEFORE taking the write
 *  mutex) — this exists for simpler end-to-end unit tests of the whole path. */
export function applyIngest(
  body: unknown,
  deviceLinks: readonly DeviceLink[],
  readings: readonly Reading[],
  now: () => Date = () => new Date(),
): { ok: true; result: ApplyIngestResult } | { ok: false; reason: string } {
  const parsed = detectAndParseIngest(body)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, result: linkAndBuildReading(parsed.reading, deviceLinks, readings, now) }
}

// ── rate limiter ─────────────────────────────────────────────────────────────

export interface IngestRateLimiter {
  /** Peek only — reports whether `deviceKey` is currently inside its
   *  cooldown window, WITHOUT recording anything. Safe to call as a cheap
   *  pre-mutex fast-reject (see `sync-server.ts`'s `POST /readings`): a
   *  device that's clearly still inside its window never reaches disk. */
  check(deviceKey: string): { allowed: true } | { allowed: false; retryAfterS: number }
  /** Record an accepted hit for `deviceKey` at the CURRENT time (calls `now()`
   *  itself). Callers MUST call this only after the request this hit gates
   *  has actually succeeded (e.g. a `POST /readings` that persisted a
   *  reading) — an outcome that never wrote anything (unlinked, batch-missing,
   *  a 500) must never burn the device's slot. */
  record(deviceKey: string): void
}

/** Default cap on how many distinct deviceKeys this limiter tracks at once —
 *  bounds memory for an internet-exposed, token-authed-but-not-otherwise-
 *  trusted endpoint: a flood of distinct (garbage or malicious) deviceKeys
 *  must never grow this map without limit. */
const DEFAULT_MAX_TRACKED_DEVICES = 10_000

/** Per-device sliding-window rate limiter: at most one accepted request per
 *  `deviceKey` every `minIntervalMs`. `minIntervalMs <= 0` disables it
 *  entirely (matches this codebase's `0 disables` convention, e.g.
 *  `SYNC_KEEP_GENERATIONS`). In-memory, per-daemon-process — resets on
 *  restart; that's an acceptable cost for "cheap protection", not a durable
 *  guarantee. Bounded to `maxTrackedDevices` entries via simple LRU eviction
 *  (a `Map` preserves insertion order; `record` re-inserts the touched key so
 *  it moves to the "most recently used" end, and evicts the map's first —
 *  least-recently-used — entry once over the cap). */
export function createIngestRateLimiter(
  minIntervalMs: number,
  now: () => Date = () => new Date(),
  maxTrackedDevices: number = DEFAULT_MAX_TRACKED_DEVICES,
): IngestRateLimiter {
  const lastAcceptedMs = new Map<string, number>()
  return {
    check(deviceKey: string) {
      if (minIntervalMs <= 0) return { allowed: true }
      const nowMs = now().getTime()
      const last = lastAcceptedMs.get(deviceKey)
      if (last !== undefined && nowMs - last < minIntervalMs) {
        return { allowed: false, retryAfterS: Math.ceil((minIntervalMs - (nowMs - last)) / 1000) }
      }
      return { allowed: true }
    },
    record(deviceKey: string) {
      if (minIntervalMs <= 0) return
      // Re-inserting moves this key to the Map's "most recently used" end.
      lastAcceptedMs.delete(deviceKey)
      if (lastAcceptedMs.size >= maxTrackedDevices) {
        const oldest = lastAcceptedMs.keys().next().value
        if (oldest !== undefined) lastAcceptedMs.delete(oldest)
      }
      lastAcceptedMs.set(deviceKey, now().getTime())
    },
  }
}
