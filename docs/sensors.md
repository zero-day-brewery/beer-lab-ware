# Automatic sensor ingestion (Tilt / iSpindel / RAPT / generic)

Automatic hydrometer/temperature logging — point a floating hydrometer (or any
script) at your sync daemon and its readings show up on the batch sheet
without you typing anything in. This is a **Track B (self-hosted daemon)**
feature: it needs the always-on [sync daemon](./deploy/README.md) running
somewhere reachable from the device. The hosted/local-only app has nowhere to
receive an inbound HTTP push, and that's a real, permanent architectural
limit — see "Why not Web Bluetooth?" below before assuming it's an oversight.

## Why not Web Bluetooth?

The original idea for this feature was "read a Tilt directly in the browser
over Bluetooth — no daemon needed." That was investigated and **rejected**;
here's why, plainly, so the decision doesn't get silently re-litigated:

A Tilt hydrometer doesn't accept a Bluetooth *connection* — it continuously
**broadcasts** its color/gravity/temperature as an Apple iBeacon
manufacturer-data advertisement, and a receiver just listens. Reading that
kind of advertisement from a web page requires the **Web Bluetooth Scanning
API** (`navigator.bluetooth.requestLEScan` + `watchAdvertisements`) — not the
"connect to a GATT device" Web Bluetooth API most sites use. As of this
writing, that scanning API is:

- **Experimental and flag-gated in Chrome/Edge** — behind
  `chrome://flags/#enable-experimental-web-platform-features`, which the
  overwhelming majority of users will never enable.
- **Not implemented in Safari/WebKit at all** — Apple has stated no intent to
  ship Web Bluetooth, scanning or otherwise.

A shipped, everyday feature cannot depend on a browser flag almost nobody
turns on, or a browser that doesn't support the API at all. So this was not
built as an in-PWA Bluetooth scanner. Instead, Tilt support reaches this app
the way the existing Tilt/iSpindel DIY ecosystem already works: through a
small bridge that already speaks HTTP —
**[TiltBridge](https://tiltbridge.com/)**, **Tilt Pi**, or the Tilt app's own
cloud-logging feature — all of which can point their output at the sync
daemon described below.

This is the honest shape of the underlying constraint, not a workaround: a
**static PWA has no server to bind a port to**, so it can never receive an
inbound push from a sensor. An **always-on daemon can**. That asymmetry is
the entire reason a self-hosted Track B tier exists — automatic sensor
ingestion is the clearest example of a capability that genuinely requires it.

## How it works

1. Your device (or its bridge) POSTs a small JSON (or form-encoded — see
   below) body to `https://<your-sync-daemon>/readings`, with a Bearer token.
   Two token scopes work here: a FULL per-device token (the same kind
   `Settings → Sync` uses), or — **recommended for sensor bridges** — an
   **ingest-scoped token** (`SYNC_INGEST_TOKEN_HASHES`, see the
   [deploy runbook](./deploy/README.md)'s token lifecycle), which can ONLY
   post readings: presented on `/state` it gets a plain 401. Bridges are the
   least-trusted credential holders on your network (TiltBridge serves its
   config — token included — on an unauthenticated LAN page; ESP-class
   firmware gives its secrets up to a flash dump), so the token they hold
   shouldn't be able to read or overwrite your whole brewery.
2. The daemon auto-detects which device format the payload is in (see below),
   normalizes it, and looks up a **device key** (e.g. `tilt:RED`,
   `ispindel:iSpindel001`) against the links you've set up in **Settings →
   Sensor devices**.
3. **Linked** → the daemon appends a `Reading` row to that batch and returns
   `200`. It shows up on the batch sheet's Fermentation Readings table with a
   colored source badge (Tilt / iSpindel / RAPT / sensor) so you can tell it
   apart from a hand-typed entry.
4. **Not linked yet** → the daemon returns `202 { status: "unlinked",
   deviceKey: "tilt:RED" }` and **persists nothing**. Go to **Settings →
   Sensor devices**, type in the `deviceKey` from that response (or read it
   off the daemon's own response/logs), pick a batch, hit **Link device** —
   **then run `Settings → Sync → Sync now`**. The link is saved in the app's
   local database and reaches the daemon only when this device PUSHES state
   (two-way or push-only mode — pull-only never pushes, so it can never
   deliver a link). Until that sync lands, the daemon keeps answering
   `202 unlinked` no matter what you've typed into Settings.
5. **Linked to a batch that's since been deleted** → the daemon returns
   `202 { status: "batch-missing", deviceKey: "tilt:RED" }` and **persists
   nothing**, same as unlinked. Deleting a batch cascade-removes its device
   link automatically (**Settings → Sensor devices** clears it too), so this
   normally only shows up for a moment right after a deletion, or if you
   hand-edit a canonical file into an inconsistent state. Re-link the device
   to a live batch to clear it. **Honest limit:** the daemon can only refuse
   what it can see — a batch deleted on a device that hasn't synced the
   deletion yet is still present in the daemon's canonical copy, so posts
   during that propagation window are still accepted. Those lag-window
   readings don't survive, though: when the deletion arrives, the merge
   cascades the batch's tombstone to its readings (a reading can't outlive
   its batch), so they die with it instead of becoming permanent orphans.

### Why 202 + persist-nothing instead of an "unassigned readings" queue?

Because the app has no view for a reading that doesn't belong to a batch —
building a holding pool would just create invisible data nobody ever sees or
cleans up. Telling the operator exactly what key showed up, so they can link
it once, is simpler and more honest than a queue that silently accumulates.
The same reasoning is why a link whose batch has been deleted also persists
nothing rather than resurrecting a batch-less reading pool.

### Re-posts are deduped — but only for shapes that supply their own timestamp

The appended reading's id is derived deterministically from
`deviceKey + timestamp + gravity + tempC + pH` (a content-addressed uuid, the
same technique the Brewfather importer uses for idempotent re-imports). A
device that retries an identical POST — a network hiccup, a firmware retry
loop — updates the SAME row instead of creating a duplicate, **provided the
timestamp is the same on both posts**.

**Be honest about what that means in practice:** only the **generic**
`{ deviceKey, ..., at? }` shape lets a caller supply its own `at`. None of the
three device-native adapters (iSpindel, Tilt "native", Brewfather-stream) send
a payload timestamp at all — every reading from those shapes is stamped with
the daemon's own `now()` at the moment it's received. A retry from one of
those devices a few seconds later gets a **different** `at`, hence a
**different** id, hence a genuinely new row — not a dedupe. For those three
shapes, the [per-device rate limit](#rate-limiting) below is the real,
practical guard against a retry storm, not this id. If you want true dedupe
for a device-native source, put it behind a bridge/script that speaks the
generic shape and supplies a stable `at`.

A genuinely new reading (different value or a later timestamp) always gets
its own row, on every shape.

### Rate limiting

Each **device** (by its normalized key) can have at most one **accepted**
ingest every `SYNC_INGEST_MIN_INTERVAL_S` seconds (default **60**, see
[`docs/deploy/README.md`](./deploy/README.md)) — a device posting faster than
that gets `429 { error: "rate limited", retryAfterS }`. This is cheap,
in-memory protection for a write endpoint that's reachable from the internet
if you've chosen to expose your daemon that way; it resets on daemon restart
and is not a durable/precise guarantee, just a floor on abuse. Set
`SYNC_INGEST_MIN_INTERVAL_S=0` to disable it if you have a good reason to
(e.g. every device already posts far apart and you want zero surprises).

## Supported device formats (auto-detected)

**Every adapter here is marked EXPERIMENTAL: validated against documented
wire formats, not against physical hardware** — no Tilt, iSpindel, or RAPT
Pill unit was available while building this. If your device's actual output
doesn't match what's documented below, please open an issue with a sample
payload (redact anything sensitive) — or just use the generic shape, which
sidesteps the guessing entirely.

### Wire tolerances + plausibility guards (all shapes)

- **Numeric fields may arrive as JSON strings.** The real Tilt app / Tilt Pi
  / TiltPico cloud-URL senders emit `{"Temp":"61.0","SG":"1.027"}` — every
  adapter's numeric reads accept a string that is exactly a finite decimal
  number (surrounding whitespace tolerated). Anything else — `"1.2.3"`, hex,
  scientific notation, an empty string — is treated as absent, never coerced
  into a surprise.
- **`application/x-www-form-urlencoded` bodies are accepted** alongside JSON:
  the Tilt app's cloud-URL feature POSTs
  `Timepoint=…&Temp=65.0&SG=1.010&Color=RED`, not JSON. Recognized via the
  declared `Content-Type`, or sniffed when a non-JSON body parses as a query
  string carrying at least one known sensor field (some senders mislabel form
  bodies as `text/plain`); anything else is an honest `400`.
- **Implausible readings are rejected, not logged.** After unit resolution,
  every shape's final values must sit inside gravity **0.9–1.2 SG**,
  temperature **−10–110 °C**, pH **(0, 14]** — a value outside those is never
  a real fermentation reading (or is a unit resolution gone wrong), so the
  POST fails with `400` instead of silently poisoning the batch chart.
- **Bodies are capped at 256 KB** (vs `/state`'s whole-brewery 64 MB
  allowance) — real sensor payloads are under 2 KB, so this is pure headroom;
  beyond the cap → `413`.

### iSpindel (HIGH confidence)

The iSpindel's stock HTTP JSON target. Detected by its `angle` field (unique
to this format) plus a `name` or numeric `ID`:

```json
{
  "name": "iSpindel000",
  "ID": 12345,
  "angle": 45.2,
  "temperature": 19.8,
  "temp_units": "C",
  "gravity": 1.042,
  "battery": 3.9
}
```

- Device key: `ispindel:<name>` (or `ispindel:<ID>` if no name is set).
- `temperature` is converted from °F to °C when `temp_units` is `"F"`; a
  missing `temp_units` is treated as **°C** — the firmware's own default.
- **Gravity is ambiguous by design**: the iSpindel's onboard calibration
  polynomial can be configured to output either SG or °Plato, and the payload
  carries no flag saying which. This is resolved by plausibility — a real SG
  reading is always in the range **0.98–1.2**; a genuine °Plato reading in
  that same numeric range would be nonsensical. A value outside 0.98–1.2 is
  treated as °Plato and converted — but ONLY when it is itself a plausible
  °Plato value (**> 0.5 and ≤ 35**). A value implausible in BOTH units (a
  zero, a negative, anything above 35 °P) fails the POST with `400` —
  refusing to guess, rather than laundering garbage into a plausible-looking
  ~1.000 SG. Whichever successful branch is taken, the response's `warnings`
  array says which interpretation was chosen. **Configure your iSpindel to
  output SG directly** if you want to avoid this guess entirely.

### Tilt — via TiltBridge / iSpindel's "Brewfather" target (HIGH confidence on the wire format)

TiltBridge's "Custom"/"Brewfather" HTTP target — and, notably, the iSpindel
firmware's own "Brewfather" target — both emit **Brewfather's own documented
custom-stream JSON contract**:

```json
{
  "name": "Tilt Red",
  "temp": 68,
  "temp_unit": "F",
  "gravity": 1.042,
  "gravity_unit": "G",
  "ph": 4.4,
  "comment": "",
  "beer": "My IPA"
}
```

- Device type + key are inferred from `name` — a name containing a stock
  Tilt color (`RED`, `GREEN`, `BLACK`, `PURPLE`, `ORANGE`, `BLUE`, `YELLOW`,
  `PINK`) and the word "Tilt" (or just a bare color name) becomes
  `tilt:<COLOR>`; a name containing "iSpindel"/"spindel" becomes
  `ispindel:<name>`; a name containing "RAPT"/"pill" becomes
  `rapt:<name>`. An unrecognized name still ingests — as `source: "other"`,
  `other:<name>` — with a warning telling you to rename the device for
  automatic detection.
- `gravity_unit: "P"`/`"Plato"`/`"Brix"` converts to SG; `"G"` (or absent) is
  treated as SG already.
- `temp_unit` accepts the contract's `C`/`F`/`K` (`K` converted, honored for
  contract completeness). A MISSING `temp_unit` defaults to **°C** —
  Brewfather's own documented contract default. An earlier draft defaulted to
  °F "because TiltBridge is the likeliest sender", but TiltBridge always
  sends an explicit `temp_unit: "F"`, so the honest contract default costs no
  real sender anything. Any OTHER explicit unit fails the POST with `400`
  naming the unit — never a silent mis-conversion.
- `ph` is parsed too (it's part of Brewfather's contract), and at least one
  of `temp`/`gravity`/`ph` must be present — a name-only body is a `400`,
  same as every other shape's no-measurement guard.
- This ONE adapter genuinely covers Tilt-via-TiltBridge, iSpindel-via-
  Brewfather-target, and anything else already pointed at a "Brewfather"
  target — no new bridge firmware needed, just pick that target if your
  device/bridge offers it.

### Tilt — "native" log shape (MEDIUM confidence)

Some DIY Tilt receivers/loggers use a simpler shape closer to the Tilt app's
own historical cloud-logging convention — detected by the presence of
`Color`, which no other adapter uses:

```json
{ "Color": "RED", "SG": 1042, "Temp": 68, "Beer": "My IPA" }
```

- Device key: `tilt:<COLOR>`.
- `SG` is documented in this convention as an **integer, gravity × 1000**
  (e.g. `1042` for SG 1.042) — a value ≥ 100 is treated that way (no real SG
  is ever ≥ 100); a smaller value is assumed to already be decimal SG, as a
  defensive fallback.
- `Temp` is ALWAYS treated as °F (the stock-firmware/app default — this shape
  has no unit field) and converted.
- The real Tilt app / Tilt Pi senders emit these numeric fields as STRINGS —
  often in a form-encoded body rather than JSON. Both are accepted (see "Wire
  tolerances" above), and the ×1000 heuristic works on the parsed value
  either way (`"1027"` → 1.027, `"1.027"` stays as-is).

### RAPT Pill — NOT a bespoke adapter (LOW confidence on any push shape)

RAPT's actual cloud integration is an **authenticated OAuth2 REST API that
RAPT's own cloud exposes for you to pull from** — not a webhook/POST target a
hobbyist can point at an arbitrary URL, the way Tilt/iSpindel's open DIY
firmware ecosystem allows. Confidence on any RAPT push/POST shape is
genuinely low, so — rather than guess and ship something that silently
doesn't work — RAPT Pill support goes through the **generic shape** below,
typically via a small script or Home Assistant automation that polls RAPT's
API and re-POSTs here. `rapt:<mac-or-name>` is the suggested device-key
convention for it, but the generic shape lets you key it however you like.

### Generic `{ deviceKey, gravity?, tempC?, ph?, at? }` — the escape hatch

For RAPT, Home Assistant, a cron+curl script, or literally anything else.
Detected first (an explicit `deviceKey` is never coincidentally present in
any device-native payload), and it's OUR OWN contract, so there's no unit
ambiguity to resolve:

```json
{
  "deviceKey": "rapt:kitchen-pill",
  "gravity": 1.042,
  "tempC": 19.5,
  "ph": 4.4,
  "at": "2026-07-10T12:00:00.000Z"
}
```

- `gravity` is always **SG**; `tempC` is always **°C**.
- `at` (ISO timestamp) is optional — omit it and the daemon stamps the
  reading with its own current time. Supply it when your source has a truer
  timestamp than "whenever it happened to reach the daemon."
- At least one of `gravity`, `tempC`, or `ph` is required.

## Linking a device

**Settings → Sensor devices** (right below Sync):

1. Point your device/bridge's HTTP target at
   `https://<your-sync-daemon>/readings`, with a Bearer token — ideally an
   **ingest-scoped** one (see the [deploy runbook](./deploy/README.md)'s
   token lifecycle), which can post readings but can't read or overwrite
   `/state`.
2. POST once (or wait for the device's next scheduled post). It'll come back
   `202 unlinked` — that response's `deviceKey` is exactly what to enter.
3. In **Settings → Sensor devices**, enter that device key and pick the batch
   it's fermenting. Hand-typed keys are normalized toward the daemon's form
   (provider prefix lowercased, a Tilt color uppercased — `Tilt: red` becomes
   `tilt:RED`; a key with no `:` is rejected inline); the identity part of
   `ispindel:`/`rapt:`/`other:` keys is case-SENSITIVE, so enter it exactly
   as the 202 response reported it.
4. **Sync now** (`Settings → Sync`). This is the step that actually delivers
   the link: it lives in the app's local database until a sync PUSHES it into
   the daemon's canonical state (two-way or push-only mode — pull-only never
   pushes). Until that sync lands the daemon keeps answering `202 unlinked`;
   after it, the device's next post lands on the batch automatically.
5. Reassign a device to a new batch any time by picking a different batch
   from its row's dropdown — this **moves** the existing link (same device,
   new batch), it never creates a second live link for the same device.
   Reassignments and unlinks propagate on your next sync too, same as a new
   link. Unlink when you're done with a device (e.g. between batches) if
   you'd rather link explicitly each time than have it silently keep feeding
   the last batch.

## Curl smoke test

```bash
# Generic shape — works against any linked deviceKey. A full device token or
# an ingest-scoped token both work on /readings.
curl -i -X POST https://<your-sync-daemon>/readings \
  -H "Authorization: Bearer <your-device-token>" \
  -H "Content-Type: application/json" \
  -d '{"deviceKey":"tilt:RED","gravity":1.042,"tempC":19.5}'

# 202 { "ok": true, "status": "unlinked", "deviceKey": "tilt:RED" } the first
# time (before you've linked it in Settings → Sensor devices), or
# 202 { "ok": true, "status": "batch-missing", "deviceKey": "tilt:RED" } if
# it WAS linked but that batch has since been deleted, or
# 200 { "ok": true, "status": "linked", "deviceKey": "tilt:RED",
#       "batchId": "...", "readingId": "...", "warnings": [] } once linked.
```

## Reading provenance in the app

Every automatically-ingested reading carries `source` (`tilt` / `ispindel` /
`rapt` / `other`). The three device-native shapes (iSpindel, Tilt "native",
Brewfather-stream) also carry `deviceId` — the raw identity the device
reported (the Tilt color, the iSpindel name/ID, the Brewfather stream's
`name`). The **generic shape has no separate identity field, so its readings
carry NO `deviceId`** — the `deviceKey` you chose is the whole identity.
Both are purely informational fields, additive to the existing `Reading`
shape (no migration, no Dexie version bump). A hand-typed reading has no
`source` at all and reads as "manual". The batch sheet's Fermentation
Readings table shows a small colored badge per row so you can tell a
sensor-logged point from something you typed in.

## How ingested readings reach your other devices

A daemon-ingested reading lands in the daemon's canonical state first — your
devices receive it on their next sync pull (two-way or pull-only mode). Even
`push-only` — the mode that deliberately replaces canonical with local
state — preserves them: readings that exist ONLY in canonical (a push-only
device never pulls them down, so they may exist nowhere else) are grafted
into what it publishes rather than overwritten. A reading you deleted locally
stays deleted (the graft never resurrects a tombstoned row), and a grafted
reading whose batch doesn't exist in the outgoing state is dropped — surfaced
as `orphanReadingsDropped` in the sync result — instead of being published as
an instant orphan.
