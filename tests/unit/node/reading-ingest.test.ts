/**
 * reading-ingest.ts — device-format adapters, device-link resolution, the
 * content-addressed dedupe id, and the rate limiter. All pure (no fs/http),
 * so this drives the ENTIRE decision logic behind `POST /readings` without a
 * running server; `tests/unit/node/sync-server.test.ts` covers the HTTP glue
 * (auth, mutex, persistence) on top of this.
 */
import { describe, expect, it } from 'vitest'
import type { DeviceLink } from '@/lib/brewing/types/device-link'
import type { Reading } from '@/lib/brewing/types/reading'
import {
  applyIngest,
  createIngestRateLimiter,
  detectAndParseIngest,
  ispindelDeviceKey,
  linkAndBuildReading,
  otherDeviceKey,
  raptDeviceKey,
  tiltDeviceKey,
} from '@/lib/node/reading-ingest'

const BATCH_A = '11111111-1111-4111-8111-111111111111'
const BATCH_B = '22222222-2222-4222-8222-222222222222'

function link(deviceKey: string, batchId: string): DeviceLink {
  return {
    id: crypto.randomUUID(),
    deviceKey,
    batchId,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

describe('deviceKey helpers', () => {
  it('tiltDeviceKey normalizes a stock color, uppercased', () => {
    expect(tiltDeviceKey('red')).toBe('tilt:RED')
    expect(tiltDeviceKey('  Green ')).toBe('tilt:GREEN')
  })
  it('tiltDeviceKey falls back to a slug for a non-stock color', () => {
    expect(tiltDeviceKey('Turquoise Special')).toBe('tilt:TURQUOISE-SPECIAL')
  })
  it('ispindelDeviceKey trims the identity', () => {
    expect(ispindelDeviceKey(' iSpindel001 ')).toBe('ispindel:iSpindel001')
  })
  it('raptDeviceKey / otherDeviceKey pass the identity through', () => {
    expect(raptDeviceKey('AA:BB:CC:DD:EE:FF')).toBe('rapt:AA:BB:CC:DD:EE:FF')
    expect(otherDeviceKey('My Sensor')).toBe('other:My Sensor')
  })
})

describe('detectAndParseIngest — generic shape', () => {
  it('parses { deviceKey, gravity, tempC, ph, at }', () => {
    const r = detectAndParseIngest({
      deviceKey: 'rapt:kitchen',
      gravity: 1.042,
      tempC: 19.5,
      ph: 4.4,
      at: '2026-07-10T12:00:00.000Z',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading).toMatchObject({
      deviceKey: 'rapt:kitchen',
      source: 'other',
      gravity: 1.042,
      tempC: 19.5,
      ph: 4.4,
      at: '2026-07-10T12:00:00.000Z',
    })
    expect(r.reading.warnings).toEqual([])
  })

  it('accepts a deviceKey-only payload with just one measurement', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', tempC: 20 })
    expect(r.ok).toBe(true)
  })

  it('rejects a deviceKey payload with no measurements at all', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x' })
    expect(r.ok).toBe(false)
  })

  it('warns and drops an unparseable "at" instead of failing', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', gravity: 1.02, at: 'not-a-date' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.at).toBeUndefined()
    expect(r.reading.warnings[0]).toMatch(/not a parseable timestamp/)
  })
})

describe('detectAndParseIngest — iSpindel', () => {
  it('parses a typical iSpindel payload (SG already, °C)', () => {
    const r = detectAndParseIngest({
      name: 'iSpindel000',
      ID: 12345,
      angle: 45.2,
      temperature: 19.8,
      temp_units: 'C',
      gravity: 1.042,
      battery: 3.9,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.deviceKey).toBe('ispindel:iSpindel000')
    expect(r.reading.source).toBe('ispindel')
    expect(r.reading.deviceId).toBe('iSpindel000')
    expect(r.reading.gravity).toBe(1.042)
    expect(r.reading.tempC).toBeCloseTo(19.8)
    // The SG-vs-Plato plausibility guess is ALWAYS surfaced, even when the
    // value lands inside the plausible-SG window — an operator reading only
    // the warnings array must be able to tell which interpretation was
    // chosen, not just when it was uncertain.
    expect(r.reading.warnings).toHaveLength(1)
    expect(r.reading.warnings[0]).toMatch(/treated as SG directly/)
  })

  it('converts °F temperature to °C', () => {
    const r = detectAndParseIngest({
      name: 'iSpindel000',
      angle: 45.2,
      temperature: 68,
      temp_units: 'F',
      gravity: 1.04,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBeCloseTo(20, 0)
  })

  it('falls back to numeric ID when name is absent', () => {
    const r = detectAndParseIngest({ ID: 999, angle: 10, gravity: 1.01 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.deviceKey).toBe('ispindel:999')
  })

  it('treats an out-of-SG-range gravity as °Plato and converts, with a warning', () => {
    // 11.9 °P ≈ SG 1.048 — a plausible plato-not-sg reading (device misconfigured).
    const r = detectAndParseIngest({ name: 'iSpindel000', angle: 10, gravity: 11.9 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBeGreaterThan(1)
    expect(r.reading.gravity).toBeLessThan(1.1)
    expect(r.reading.warnings[0]).toMatch(/treated as °Plato/)
  })

  it('rejects an iSpindel-shaped payload missing both name and ID', () => {
    const r = detectAndParseIngest({ angle: 10, gravity: 1.04 })
    // No name/ID and no other adapter claims it either (no deviceKey, no
    // Color, no gravity+name pairing) → falls through to unrecognized.
    expect(r.ok).toBe(false)
  })

  it('defaults a MISSING temp_units to °C — the firmware default — NOT °F', () => {
    // 20 read as °F would be ≈ -6.7 °C — inside the plausibility bounds, so
    // only this assertion catches a future default flip.
    const r = detectAndParseIngest({
      name: 'iSpindel000',
      angle: 10,
      temperature: 20,
      gravity: 1.04,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBe(20)
  })

  // The gravity-plausibility failures below are the fix for the old behavior
  // that piped implausible values (0, negatives, tiny noise) through platoToSG
  // and laundered them into a plausible-LOOKING ~1.000 SG.
  it('rejects gravity 0 outright instead of converting it to a plausible-looking SG', () => {
    const r = detectAndParseIngest({ name: 'iSpindel000', angle: 10, gravity: 0 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/refusing to guess/)
  })

  it('rejects a negative gravity outright', () => {
    const r = detectAndParseIngest({ name: 'iSpindel000', angle: 10, gravity: -5 })
    expect(r.ok).toBe(false)
  })

  it('rejects a gravity implausible in BOTH units (above 35 °P, outside SG range)', () => {
    const r = detectAndParseIngest({ name: 'iSpindel000', angle: 10, gravity: 50 })
    expect(r.ok).toBe(false)
  })

  it('rejects gravity at exactly 0.5 — the °Plato floor is exclusive', () => {
    const r = detectAndParseIngest({ name: 'iSpindel000', angle: 10, gravity: 0.5 })
    expect(r.ok).toBe(false)
  })

  it('still accepts gravity at the 35 °P ceiling (inclusive) and converts it', () => {
    const r = detectAndParseIngest({ name: 'iSpindel000', angle: 10, gravity: 35 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBeCloseTo(1.154, 2)
    expect(r.reading.warnings[0]).toMatch(/treated as °Plato/)
  })
})

describe('detectAndParseIngest — Tilt native (Color + SG×1000)', () => {
  it('parses SG encoded as int×1000 and Temp in °F', () => {
    const r = detectAndParseIngest({ Color: 'RED', SG: 1042, Temp: 68, Beer: 'My IPA' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.deviceKey).toBe('tilt:RED')
    expect(r.reading.source).toBe('tilt')
    expect(r.reading.deviceId).toBe('RED')
    expect(r.reading.gravity).toBeCloseTo(1.042)
    expect(r.reading.tempC).toBeCloseTo(20, 0)
  })

  it('accepts SG already decimal (defensive — some bridges send it that way)', () => {
    const r = detectAndParseIngest({ Color: 'GREEN', SG: 1.042 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBeCloseTo(1.042)
  })

  it('rejects a Tilt-native payload with neither SG nor Temp (same at-least-one-measurement guard as generic)', () => {
    const r = detectAndParseIngest({ Color: 'BLUE' })
    expect(r.ok).toBe(false)
  })

  it('Temp is ALWAYS read as °F — the stock-firmware default (this shape has no unit field)', () => {
    // Pin the default so a future flip to °C fails a test: 68 °F ≈ 20 °C, and
    // 68 read as °C would slip straight through the plausibility bounds.
    const r = detectAndParseIngest({ Color: 'RED', Temp: 68 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBeCloseTo(20, 0)
  })
})

describe('detectAndParseIngest — numeric-string tolerance (real Tilt app / Tilt Pi / TiltPico senders)', () => {
  it('parses the real Tilt-app cloud-URL payload with STRING numeric values', () => {
    // Verbatim shape from the Tilt app / Tilt Pi cloud-URL logging feature —
    // rejecting strings here would reject real hardware.
    const r = detectAndParseIngest({ Temp: '61.0', SG: '1.027', Color: 'ORANGE' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.deviceKey).toBe('tilt:ORANGE')
    expect(r.reading.gravity).toBeCloseTo(1.027)
    expect(r.reading.tempC).toBeCloseTo(16.1, 1)
  })

  it('the ×1000 heuristic works on the STRING int form too ("1027" → 1.027)', () => {
    const r = detectAndParseIngest({ Color: 'RED', SG: '1027' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBeCloseTo(1.027)
  })

  it('accepts an all-string iSpindel payload (angle drives detection too)', () => {
    const r = detectAndParseIngest({
      name: 'iSpindel000',
      angle: '45.2',
      temperature: '19.8',
      temp_units: 'C',
      gravity: '1.042',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBe(1.042)
    expect(r.reading.tempC).toBeCloseTo(19.8)
  })

  it('accepts string numerics in the Brewfather stream shape, ph included', () => {
    const r = detectAndParseIngest({
      name: 'Tilt Red',
      temp: '68',
      temp_unit: 'F',
      gravity: '1.042',
      ph: '4.3',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBeCloseTo(20, 0)
    expect(r.reading.gravity).toBe(1.042)
    expect(r.reading.ph).toBe(4.3)
  })

  it('accepts string numerics in the generic shape, surrounding whitespace tolerated', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', gravity: ' 1.042 ', tempC: '19.5' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBe(1.042)
    expect(r.reading.tempC).toBe(19.5)
  })

  it('rejects strings that are not exactly a finite decimal number', () => {
    // Each yields no usable measurement → the at-least-one-measurement guard
    // fails the parse; none is ever coerced into a surprise number.
    for (const bad of ['1.2.3', '', '   ', '0x10', '1e3', 'NaN', 'Infinity']) {
      expect(detectAndParseIngest({ deviceKey: 'other:x', gravity: bad }).ok).toBe(false)
    }
  })
})

describe('detectAndParseIngest — Brewfather custom-stream shape (TiltBridge / iSpindel "Brewfather" target)', () => {
  it('identifies a Tilt from a "Tilt <color>" name', () => {
    const r = detectAndParseIngest({
      name: 'Tilt Red',
      temp: 68,
      temp_unit: 'F',
      gravity: 1.042,
      gravity_unit: 'G',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('tilt')
    expect(r.reading.deviceKey).toBe('tilt:RED')
    expect(r.reading.tempC).toBeCloseTo(20, 0)
    expect(r.reading.gravity).toBeCloseTo(1.042)
    expect(r.reading.warnings).toEqual([])
  })

  it('converts Plato gravity_unit to SG', () => {
    const r = detectAndParseIngest({ name: 'Tilt Red', gravity: 11.9, gravity_unit: 'P' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.gravity).toBeCloseTo(1.048, 2)
  })

  it('honors temp_unit C without converting', () => {
    const r = detectAndParseIngest({ name: 'Tilt Red', temp: 19, temp_unit: 'C', gravity: 1.04 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBe(19)
  })

  it('defaults a MISSING temp_unit to °C — the contract default — NOT °F', () => {
    // 20 read as °F would be ≈ -6.7 °C (inside the plausibility bounds, so it
    // would slip through silently) — the unit default is load-bearing here.
    const r = detectAndParseIngest({ name: 'Tilt Red', temp: 20, gravity: 1.04 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBe(20)
  })

  it('converts temp_unit K (Kelvin) to °C', () => {
    const r = detectAndParseIngest({
      name: 'Tilt Red',
      temp: 293.15,
      temp_unit: 'K',
      gravity: 1.04,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.tempC).toBeCloseTo(20, 5)
  })

  it('rejects an unrecognized explicit temp_unit with an error naming it', () => {
    const r = detectAndParseIngest({ name: 'Tilt Red', temp: 20, temp_unit: 'R', gravity: 1.04 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/temp_unit "R"/)
  })

  it("parses the contract's documented ph field", () => {
    const r = detectAndParseIngest({ name: 'Tilt Red', gravity: 1.04, ph: 4.3 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.ph).toBe(4.3)
  })

  it('accepts a ph-only payload — ph counts as a measurement', () => {
    const r = detectAndParseIngest({ name: 'Kitchen pH meter', ph: 4.5 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.ph).toBe(4.5)
    expect(r.reading.source).toBe('other')
  })

  it('rejects a payload with no usable measurement at all (same guard as every other adapter)', () => {
    // `temp` is present but unparseable — without the guard this would persist
    // a measurement-less reading.
    const r = detectAndParseIngest({ name: 'Tilt Red', temp: 'garbage' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/none of temp, gravity, or ph/)
  })

  it('does NOT infer a Tilt from a color that is only a substring of a word', () => {
    const r = detectAndParseIngest({ name: 'Redwood Fermenter Probe', gravity: 1.05 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('other')
    expect(r.reading.deviceKey).toBe('other:Redwood Fermenter Probe')
    expect(r.reading.warnings[0]).toMatch(/could not identify/)
  })

  it('a name that IS exactly a color (case-insensitive) is still a Tilt', () => {
    const r = detectAndParseIngest({ name: 'orange', gravity: 1.05 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('tilt')
    expect(r.reading.deviceKey).toBe('tilt:ORANGE')
  })

  it('a bare color as its own word within a name is still a Tilt', () => {
    const r = detectAndParseIngest({ name: 'Fermenter Red', gravity: 1.05 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('tilt')
    expect(r.reading.deviceKey).toBe('tilt:RED')
  })

  it('identifies an iSpindel routed through the Brewfather target', () => {
    const r = detectAndParseIngest({ name: 'My iSpindel Kitchen', gravity: 1.05 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('ispindel')
    expect(r.reading.deviceKey).toBe('ispindel:My iSpindel Kitchen')
  })

  it('falls back to source "other" with a warning for an unrecognized name', () => {
    const r = detectAndParseIngest({ name: 'Kitchen Sensor 3', gravity: 1.03 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('other')
    expect(r.reading.deviceKey).toBe('other:Kitchen Sensor 3')
    expect(r.reading.warnings[0]).toMatch(/could not identify/)
  })

  it('is claimed by iSpindel/Tilt-native FIRST when the payload also carries their distinctive field', () => {
    // Has `angle` too — must be claimed by the iSpindel adapter, not this one.
    const r = detectAndParseIngest({ name: 'Tilt Red', gravity: 1.04, angle: 12 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reading.source).toBe('ispindel')
  })
})

describe('detectAndParseIngest — malformed / unrecognized', () => {
  it('rejects a non-object body', () => {
    expect(detectAndParseIngest('hello').ok).toBe(false)
    expect(detectAndParseIngest(42).ok).toBe(false)
    expect(detectAndParseIngest(null).ok).toBe(false)
    expect(detectAndParseIngest([1, 2, 3]).ok).toBe(false)
  })

  it('rejects an empty object', () => {
    expect(detectAndParseIngest({}).ok).toBe(false)
  })

  it('rejects an object with fields that match no known adapter', () => {
    expect(detectAndParseIngest({ foo: 'bar', baz: 42 }).ok).toBe(false)
  })
})

describe('detectAndParseIngest — gravity/tempC/ph plausibility bounds', () => {
  it('rejects a generic gravity above the 0.9-1.2 SG bound', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', gravity: 1.5 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/gravity/i)
  })

  it('rejects a generic gravity below the 0.9-1.2 SG bound', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', gravity: 0.5 })
    expect(r.ok).toBe(false)
  })

  it('rejects a tempC above the -10..110 bound', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', tempC: 200 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/temp/i)
  })

  it('rejects a tempC below the -10..110 bound', () => {
    const r = detectAndParseIngest({ deviceKey: 'other:x', tempC: -50 })
    expect(r.ok).toBe(false)
  })

  it('accepts values exactly at the inclusive bounds', () => {
    expect(detectAndParseIngest({ deviceKey: 'other:x', gravity: 0.9 }).ok).toBe(true)
    expect(detectAndParseIngest({ deviceKey: 'other:x', gravity: 1.2 }).ok).toBe(true)
    expect(detectAndParseIngest({ deviceKey: 'other:x', tempC: -10 }).ok).toBe(true)
    expect(detectAndParseIngest({ deviceKey: 'other:x', tempC: 110 }).ok).toBe(true)
  })

  it('applies the SAME bound to a device-native (Tilt) reading after unit resolution', () => {
    // SG×1000 = 1500 resolves to 1.5 — outside the bound, must still be rejected.
    const r = detectAndParseIngest({ Color: 'RED', SG: 1500 })
    expect(r.ok).toBe(false)
  })

  it('rejects ph at or below 0 — the bound is exclusive at 0', () => {
    // ph: 0 is a present measurement (it passes the at-least-one guard), so
    // only the plausibility bound stands between it and a persisted row.
    const zero = detectAndParseIngest({ deviceKey: 'other:x', ph: 0 })
    expect(zero.ok).toBe(false)
    if (zero.ok) return
    expect(zero.reason).toMatch(/ph/)
    expect(detectAndParseIngest({ deviceKey: 'other:x', ph: -1 }).ok).toBe(false)
  })

  it('rejects ph above 14, accepts exactly 14 (inclusive upper bound)', () => {
    expect(detectAndParseIngest({ deviceKey: 'other:x', ph: 14.5 }).ok).toBe(false)
    expect(detectAndParseIngest({ deviceKey: 'other:x', ph: 14 }).ok).toBe(true)
  })

  it('applies the SAME ph bound to the Brewfather stream shape', () => {
    const r = detectAndParseIngest({ name: 'Tilt Red', ph: 15 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/ph/)
  })
})

describe('detectAndParseIngest — deviceKey/deviceId length caps', () => {
  it('rejects a generic deviceKey over 128 characters with 400-shaped reason', () => {
    const r = detectAndParseIngest({ deviceKey: 'x'.repeat(129), gravity: 1.04 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/deviceKey/i)
  })

  it('accepts a deviceKey at exactly 128 characters', () => {
    const r = detectAndParseIngest({ deviceKey: 'x'.repeat(128), gravity: 1.04 })
    expect(r.ok).toBe(true)
  })

  it('rejects an over-long deviceId even when the normalized deviceKey is short', () => {
    // A stock color buried in a 133-char Color string normalizes to the 8-char
    // key "tilt:RED" — but the RAW string would be persisted as deviceId,
    // synced, and rendered by every client. The deviceId cap has to catch it.
    const r = detectAndParseIngest({ Color: `RED${'x'.repeat(130)}`, SG: 1042 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/deviceId/i)
  })

  it('accepts a deviceId at exactly 128 characters', () => {
    const r = detectAndParseIngest({ Color: `RED${'x'.repeat(125)}`, SG: 1042 })
    expect(r.ok).toBe(true)
  })
})

describe('linkAndBuildReading', () => {
  const fixedNow = () => new Date('2026-07-15T00:00:00.000Z')

  it('returns unlinked + an UNCHANGED readings array when no link matches the deviceKey', () => {
    const readings: Reading[] = []
    const result = linkAndBuildReading(
      { deviceKey: 'tilt:RED', source: 'tilt', gravity: 1.04, warnings: [] },
      [link('tilt:GREEN', BATCH_A)],
      readings,
      fixedNow,
    )
    expect(result.outcome).toEqual({ status: 'unlinked', deviceKey: 'tilt:RED' })
    expect(result.nextReadings).toBe(readings) // reference-equal — literally untouched
  })

  it('appends a Reading for a linked device, batchId from the link, source/deviceId carried through', () => {
    const result = linkAndBuildReading(
      {
        deviceKey: 'tilt:RED',
        source: 'tilt',
        deviceId: 'RED',
        gravity: 1.04,
        tempC: 20,
        warnings: [],
      },
      [link('tilt:RED', BATCH_A)],
      [],
      fixedNow,
    )
    expect(result.outcome.status).toBe('linked')
    if (result.outcome.status !== 'linked') return
    expect(result.outcome.batchId).toBe(BATCH_A)
    expect(result.outcome.reading.batchId).toBe(BATCH_A)
    expect(result.outcome.reading.source).toBe('tilt')
    expect(result.outcome.reading.deviceId).toBe('RED')
    expect(result.outcome.reading.gravity).toBe(1.04)
    expect(result.nextReadings).toHaveLength(1)
    expect(result.nextReadings[0]).toEqual(result.outcome.reading)
  })

  it('uses the device-supplied `at` when present, else falls back to `now()`', () => {
    const withAt = linkAndBuildReading(
      { deviceKey: 'tilt:RED', source: 'tilt', at: '2026-01-01T00:00:00.000Z', warnings: [] },
      [link('tilt:RED', BATCH_A)],
      [],
      fixedNow,
    )
    expect(withAt.outcome.status).toBe('linked')
    if (withAt.outcome.status === 'linked')
      expect(withAt.outcome.reading.at).toBe('2026-01-01T00:00:00.000Z')

    const withoutAt = linkAndBuildReading(
      { deviceKey: 'tilt:RED', source: 'tilt', warnings: [] },
      [link('tilt:RED', BATCH_A)],
      [],
      fixedNow,
    )
    expect(withoutAt.outcome.status).toBe('linked')
    if (withoutAt.outcome.status === 'linked') {
      expect(withoutAt.outcome.reading.at).toBe(fixedNow().toISOString())
    }
  })

  it('dedupes an identical re-post: same deviceKey/at/values → same id → upsert, not a duplicate row', () => {
    const parsed = { deviceKey: 'tilt:RED', source: 'tilt' as const, gravity: 1.04, warnings: [] }
    const first = linkAndBuildReading(parsed, [link('tilt:RED', BATCH_A)], [], fixedNow)
    expect(first.outcome.status).toBe('linked')
    if (first.outcome.status !== 'linked') return

    const second = linkAndBuildReading(
      parsed,
      [link('tilt:RED', BATCH_A)],
      first.nextReadings,
      fixedNow,
    )
    expect(second.outcome.status).toBe('linked')
    if (second.outcome.status !== 'linked') return

    expect(second.outcome.reading.id).toBe(first.outcome.reading.id)
    expect(second.nextReadings).toHaveLength(1) // no duplicate
  })

  it('a genuinely different reading (different gravity) from the same device mints a NEW id, coexisting', () => {
    const linkRow = link('tilt:RED', BATCH_A)
    const first = linkAndBuildReading(
      {
        deviceKey: 'tilt:RED',
        source: 'tilt',
        gravity: 1.05,
        at: '2026-07-01T00:00:00.000Z',
        warnings: [],
      },
      [linkRow],
      [],
      fixedNow,
    )
    expect(first.outcome.status).toBe('linked')
    if (first.outcome.status !== 'linked') return
    const second = linkAndBuildReading(
      {
        deviceKey: 'tilt:RED',
        source: 'tilt',
        gravity: 1.02,
        at: '2026-07-05T00:00:00.000Z',
        warnings: [],
      },
      [linkRow],
      first.nextReadings,
      fixedNow,
    )
    expect(second.outcome.status).toBe('linked')
    if (second.outcome.status !== 'linked') return
    expect(second.outcome.reading.id).not.toBe(first.outcome.reading.id)
    expect(second.nextReadings).toHaveLength(2)
  })

  it('two different devices linked to different batches never collide', () => {
    const links = [link('tilt:RED', BATCH_A), link('ispindel:i1', BATCH_B)]
    const a = linkAndBuildReading(
      { deviceKey: 'tilt:RED', source: 'tilt', gravity: 1.04, warnings: [] },
      links,
      [],
      fixedNow,
    )
    expect(a.outcome.status).toBe('linked')
    if (a.outcome.status !== 'linked') return
    const b = linkAndBuildReading(
      { deviceKey: 'ispindel:i1', source: 'ispindel', gravity: 1.03, warnings: [] },
      links,
      a.nextReadings,
      fixedNow,
    )
    expect(b.outcome.status).toBe('linked')
    if (b.outcome.status !== 'linked') return
    expect(b.nextReadings).toHaveLength(2)
    expect(a.outcome.reading.batchId).toBe(BATCH_A)
    expect(b.outcome.reading.batchId).toBe(BATCH_B)
  })

  // Duplicate links for one deviceKey CAN exist post-LWW-merge (the table is
  // deliberately not unique-indexed) — resolution must be deterministic, not
  // whatever `Array.find` happens to hit first.
  function linkAt(deviceKey: string, batchId: string, updatedAt: string, id: string): DeviceLink {
    return {
      id,
      deviceKey,
      batchId,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt,
      schemaVersion: 1,
    }
  }

  it('duplicate links: the most recently updated one wins, regardless of array order', () => {
    const older = linkAt('tilt:RED', BATCH_A, '2026-07-01T00:00:00.000Z', crypto.randomUUID())
    const newer = linkAt('tilt:RED', BATCH_B, '2026-07-10T00:00:00.000Z', crypto.randomUUID())
    const parsed = { deviceKey: 'tilt:RED', source: 'tilt' as const, gravity: 1.04, warnings: [] }
    for (const links of [
      [older, newer],
      [newer, older],
    ]) {
      const result = linkAndBuildReading(parsed, links, [], fixedNow)
      expect(result.outcome.status).toBe('linked')
      if (result.outcome.status === 'linked') expect(result.outcome.batchId).toBe(BATCH_B)
    }
  })

  it('duplicate links with the SAME updatedAt: lowest id wins, regardless of array order', () => {
    const sameAt = '2026-07-10T00:00:00.000Z'
    const lowId = linkAt('tilt:RED', BATCH_A, sameAt, '33333333-3333-4333-8333-333333333333')
    const highId = linkAt('tilt:RED', BATCH_B, sameAt, '99999999-9999-4999-8999-999999999999')
    const parsed = { deviceKey: 'tilt:RED', source: 'tilt' as const, gravity: 1.04, warnings: [] }
    for (const links of [
      [lowId, highId],
      [highId, lowId],
    ]) {
      const result = linkAndBuildReading(parsed, links, [], fixedNow)
      expect(result.outcome.status).toBe('linked')
      if (result.outcome.status === 'linked') expect(result.outcome.batchId).toBe(BATCH_A)
    }
  })
})

describe('applyIngest (detect + link in one call)', () => {
  it('propagates a parse failure as ok:false', () => {
    const r = applyIngest({}, [], [])
    expect(r.ok).toBe(false)
  })

  it('end-to-end: a valid Tilt-native payload against a matching link appends', () => {
    const r = applyIngest({ Color: 'RED', SG: 1042, Temp: 68 }, [link('tilt:RED', BATCH_A)], [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.outcome.status).toBe('linked')
  })

  it('end-to-end: a valid payload with no matching link is unlinked', () => {
    const r = applyIngest({ Color: 'RED', SG: 1042 }, [link('tilt:GREEN', BATCH_A)], [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.outcome).toEqual({ status: 'unlinked', deviceKey: 'tilt:RED' })
  })
})

describe('createIngestRateLimiter', () => {
  it('check() allows the first look for a device; record() then makes an immediate second check fail', () => {
    let t = 0
    const limiter = createIngestRateLimiter(60_000, () => new Date(t))
    expect(limiter.check('tilt:RED')).toEqual({ allowed: true })
    limiter.record('tilt:RED')
    t += 1000 // 1s later, well inside the 60s window
    const second = limiter.check('tilt:RED')
    expect(second.allowed).toBe(false)
    if (!second.allowed) expect(second.retryAfterS).toBe(59)
  })

  it('check() alone NEVER records — repeated checks with no record() stay allowed forever', () => {
    let t = 0
    const limiter = createIngestRateLimiter(60_000, () => new Date(t))
    expect(limiter.check('tilt:RED').allowed).toBe(true)
    t += 1
    expect(limiter.check('tilt:RED').allowed).toBe(true)
    t += 1
    expect(limiter.check('tilt:RED').allowed).toBe(true)
  })

  it('allows again once the window elapses since the last record()', () => {
    let t = 0
    const limiter = createIngestRateLimiter(60_000, () => new Date(t))
    limiter.record('tilt:RED')
    t += 60_000
    expect(limiter.check('tilt:RED').allowed).toBe(true)
  })

  it('tracks devices independently — one device being limited never blocks another', () => {
    const t = 0
    const limiter = createIngestRateLimiter(60_000, () => new Date(t))
    limiter.record('tilt:RED')
    expect(limiter.check('tilt:GREEN').allowed).toBe(true) // different device, same instant
  })

  it('minIntervalMs <= 0 disables rate limiting entirely (check and record both no-ops)', () => {
    const limiter = createIngestRateLimiter(0, () => new Date(0))
    expect(limiter.check('tilt:RED').allowed).toBe(true)
    limiter.record('tilt:RED')
    expect(limiter.check('tilt:RED').allowed).toBe(true)
    limiter.record('tilt:RED')
    expect(limiter.check('tilt:RED').allowed).toBe(true)
  })

  it('bounds tracked-device memory: recording past the cap evicts the least-recently-recorded device', () => {
    let t = 0
    const limiter = createIngestRateLimiter(60_000, () => new Date(t), 2)
    limiter.record('device:a')
    t += 1
    limiter.record('device:b')
    t += 1
    // Cap is 2 — recording a third device must evict the oldest ('device:a'),
    // so 'device:a' is no longer rate-limited (its record was forgotten) even
    // though its window hasn't elapsed.
    limiter.record('device:c')
    expect(limiter.check('device:a').allowed).toBe(true) // evicted, not tracked anymore
    expect(limiter.check('device:b').allowed).toBe(false) // still tracked, still inside window
    expect(limiter.check('device:c').allowed).toBe(false) // still tracked, still inside window
  })
})
