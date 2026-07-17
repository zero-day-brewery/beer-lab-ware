# Changelog

All notable changes to Beer-Lab-Ware are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/).

**Versioning policy**

- Pre-1.0, minor versions (`0.x`) may contain breaking changes — each release's
  notes say so explicitly when they do.
- **Data-migration guarantee:** every release states its Dexie schema version and
  backup-envelope version (`DumpVn`). Your data always migrates forward
  automatically on first launch of a new version; a release never silently drops
  or rewrites user data. If a release can't migrate something, it refuses loudly
  instead of guessing.
- **Self-hosters:** when a release bumps the dump-envelope version, upgrade the
  sync daemon **before or together with** the app — older daemons reject newer
  envelopes by design. Release notes call this out whenever it applies.

## [Unreleased]

### Added
- **Brewfather migration importer.** The Import page can now migrate a whole
  Brewfather brewery from its JSON export — recipes, batches (with recipe
  snapshots, measured OG/FG/volumes, brew dates, and fermentation readings),
  and ingredient inventory (fermentables / hops / yeasts / miscs). Preview
  first: per-entity counts + a warnings list before anything is written.
  Idempotent: ids derive deterministically from Brewfather `_id`s (dedicated
  UUIDv5 namespace), so re-importing the same export duplicates nothing and
  never overwrites rows you've edited since. Ledger-safe: every imported
  inventory item is written atomically with its opening-balance transaction,
  so the doctor's ledger invariant holds from the first import. Parsing is
  version-tolerant and never guesses — ambiguous fields (dry-hop durations,
  non-USD costs, unmappable units) are skipped with a per-row warning.
- **Per-batch cost (COGS).** The data model always had both halves — inventory
  prices (`pricePerUnit_USD`) and exact per-batch consumption (batchId-linked
  ledger transactions) — and a new pure engine
  (`src/lib/brewing/report/batch-cost.ts`) finally joins them. The batch sheet
  gains a read-only **Batch Cost** section (line table, known total, cost per
  liter — per gallon in imperial via the display-units layer), computed live
  from the ledger. Honest by design: items with no price are listed but NEVER
  estimated — they're excluded from the total and surfaced as "n items
  unpriced"; `sync-reconcile` ledger entries are ignored (they're sync
  accounting corrections, not consumption); returns/positive adjustments on a
  batch reduce its cost; deleted inventory items still appear, named from the
  recipe snapshot when recoverable. Cost per liter uses the measured
  into-fermenter volume when present, else the recipe batch size. All money is
  explicit **USD** (the only currency the price field stores) — no locale
  guessing. Pure read-model: no storage schema change.
- **Printable brew-day sheet.** The recipe brew sheet's existing Print button
  now produces a clean one-pager: app chrome (header, sidebar, AI companion
  FAB) and the on-screen brew-history section drop out in print, tables
  tighten up, and a print-only **Brew-day actuals** block adds ruled blanks
  (mash pH, pre-boil gravity, OG, FG, notes) to pencil in at the kettle. Mash
  steps with strike/infusion values, water volumes, the hop schedule with
  times, and OG/FG/ABV/IBU/SRM targets were already on the sheet — and honor
  the units preference. All print rules live inside the single `@media print`
  block (guarded by a unit test) so nothing leaks into screen rendering.
- **Completed-batch record export (.xlsx) + readings CSV.** New batch-sheet
  actions: **Batch record (.xlsx)** builds a workbook (`Batch` — metadata,
  results vs targets, tasting; `Timeline` — log entries; `Readings`; plus
  `Cost` whenever the batch has costed ledger lines) via the same ReportColumn
  machinery as the inventory report, with volumes/temps in the user's display
  units; **Readings CSV** exports the fermentation readings (ISO timestamp,
  gravity, tempC, pH, note) through a small RFC-4180 serializer (quoted/escaped
  notes, CRLF, canonical °C with the unit named in the header).
- **App-wide imperial display units.** The Settings "imperial (gal / lb / °F)"
  preference now converts every major surface — recipe editor (batch size gal,
  fermentables lb, hops oz, mash temps °F), recipe brew sheet + cards, live
  calculation panel, scale-recipe modal, batch-sheet volumes, calculators
  (strike temp °F + qt/lb, pitch rate gal, carbonation temps °F), equipment
  profiles (vessel volumes gal, evaporation gal/hr, grain absorption qt/lb),
  brew-start water gate, and guided brew-day value displays. Storage stays
  canonical metric (L / kg / g / °C) — a display/parse layer only
  (`convert/display-units.ts`, `useDisplayUnits`, `UnitNumberInput`), so
  existing data, dumps, and BeerXML round-trips are untouched. An e2e spec
  locks the toggle against regression. Deliberately unconverted: inventory +
  misc amounts (freeform per-item units), water-salt grams + lactic mL
  (brewing convention), Brix, psi, yeast slurry mL.
- **In-app sync connection UI — multi-device sync is now end-to-end usable.** This
  closes the gap where the daemon + client sync library shipped fully tested but no
  UI could reach them (README used to say "the in-app connection UI is still on the
  roadmap" — it exists now). **Settings → Sync**: server URL (https required; http
  only for localhost, with the reason shown inline) + per-device token
  (password-type field), **Test connection** (`GET /health` → daemon version +
  dump-version compatibility vs the app's own `DUMP_VERSION`, with an explicit
  "server accepts up to vN, this app writes vM — update the server" mismatch
  message), and **Sync now** with progress + a human-readable outcome toast (typed
  failures — push-conflict after bounded retries, 401 auth, network, version
  mismatch — each get their own message; token material never appears in any toast,
  log, or stored outcome, with a defense-in-depth scrub on top). Both values live in
  the DEVICE-LOCAL `appMeta` store: they are never written into a backup dump and
  never enter the sync payload (frozen by `tests/unit/node/sync-secret-exclusion.test.ts`,
  which now also proves it against a real dump + a real pushed payload).
- Sync modes (`syncOnce({ mode })`): `two-way` (default — pull → merge →
  snapshot+restore → push, unchanged), `pull-only` (pull + merge + snapshot +
  restore, NEVER pushes — including no first-push seeding of an empty store;
  "phone follows"), and `push-only` (publish local state as canonical with full
  If-Match handling incl. the empty-store bootstrap and 412-retry via the
  rejection's surfaced etag; never merges or restores remote data down; "desktop is
  canonical"). The Settings card defaults to two-way; the one-way modes sit behind
  an Advanced disclosure with one-line explanations.
- Sync daemon: **opt-in CORS** via `SYNC_ALLOWED_ORIGINS` (comma-separated EXACT
  origins — wildcards refuse to start, deliberately; see docs/deploy/README.md).
  Needed only when the app is served from a different origin than the daemon (e.g.
  a hosted PWA + self-hosted daemon). When set: matching `Origin` is echoed (never
  `*`) with `Vary: Origin` and `Access-Control-Expose-Headers: ETag` (the client's
  optimistic-concurrency loop must read the ETag cross-origin); non-matching
  origins get no CORS headers; `OPTIONS` preflight answers a tokenless 204
  (`GET,PUT,OPTIONS`; `Authorization,Content-Type,If-Match`; 24 h max-age) and
  never touches brewery data; auth on `/state` is not relaxed in any way. Unset
  (default): zero CORS headers — byte-identical behavior to before, which is what
  the same-origin Caddy reference deploy wants.
- Diagnostics → Multi-device sync is now live state instead of a static
  placeholder: configured server, reachability (`GET /health`), dump-version
  compatibility, an auth check (a HEAD-less probe — `GET /state` with the response
  body cancelled after the status, so a status row never downloads the whole
  canonical state), and the last sync attempt's timestamp + outcome (recorded in
  `appMeta` on every attempt, success or failure).
- Deletion tombstones for the sync merge (`rowTombstones`, Dexie schema v11,
  `DumpV9`): every repo delete path (`db/repos/*.ts`) now writes a `{ id, table,
  deletedAt }` tombstone in the SAME Dexie transaction as the delete — a
  stock-transaction cascade delete (e.g. deleting an inventory item) tombstones
  the cascaded ledger rows too, so they can't resurrect the item they belonged
  to. `mergeState`/`mergeLedger` (`sync/merge.ts`) take an optional per-table
  tombstone map and suppress any row at-or-before its tombstone's `deletedAt`;
  a row edited/created STRICTLY AFTER `deletedAt` beats the tombstone and
  survives (edit-after-delete, LWW-symmetric with every other timestamp
  comparison in the merge — same wall-clock caveat). `mergeTombstones` unions
  both sides' tombstone sets (keyed by table+id, LWW by `deletedAt`);
  `mergeDumpTables` drops a tombstone once its row has legitimately survived
  (superseded) and garbage-collects tombstones older than 180 days that no
  longer match a row in either input dump (bounded growth, never GC's one
  still needed to suppress a device that hasn't synced the deletion yet). This
  closes the two-way-sync gate documented in `sync-client.ts`'s file header —
  the merge no longer resurrects a row deleted on one device from another
  device's stale, pre-delete copy; the in-app connection UI shipped in this
  same release (see above). A still-live inventory item whose ENTIRE
  ledger history was cascade-tombstoned away by another device's delete (it
  survived via edit-after-delete) reconciles instead of wedging: `amount ===
  Σdeltas` is restarted from a reconciled "opening" that preserves the item's
  own (surviving) amount, so the daemon's ledger-invariant check never
  400s forever on it (known limitation: a device-scoped cascade only
  tombstones the ledger rows THAT device could see — a row created on a
  third device that never synced with the deleter can survive as an
  untombstoned orphan and rejoin a resurrected item's sum through the normal
  reprojection path, same as any other surviving ledger row). A full backup
  IMPORT (`backupService.restore(dump, { bumpTimestamps: true })` — the
  in-app "Import backup" flow) both clears the LOCAL tombstone for any row id
  it (re)creates AND bumps each restored row's own last-write timestamp to
  the moment of the restore, so it beats a tombstone still held by the sync
  CANONICAL too — a restore now wins fleet-wide on the next sync, not just
  locally until that sync silently re-deletes it again.
  `equipmentProfiles`/`ingredients`/`brewTimers`/`waterProfiles` carry no
  last-write timestamp field and can't win this way; the internal sync-merge
  restore (routine syncing) never bumps timestamps — only an explicit import
  does. New doctor check `C8` (warn, read-only, no auto-fix): flags a live
  row that coexists with a tombstone that should have suppressed it (a merge
  bug or a hand-edited import) and reports the total tombstone count.
- `TERMS.md` (plain-language terms incl. safety notes for pressure calculators),
  `PRIVACY.md` (the app doesn't phone home; BYO-AI egress disclosed), `NOTICE`
  (BJCP 2021 attribution + model citations), `SECURITY.md` (private reporting +
  threat model), `CODE_OF_CONDUCT.md`, issue forms, and a PR template.
- In-app safety note on the carbonation/spunding/line-balance calculators.
- Contributor DCO sign-off policy and trademark note in `CONTRIBUTING.md`.
- Declared Node support: `engines` field + `.nvmrc` (Node 22/24).
- Sync daemon: unauthenticated `GET /health` (`{ ok, daemonVersion, supportedDumpVersions }`)
  for uptime monitoring — never touches or leaks brewery data; every other route keeps
  mandatory Bearer auth.
- Sync daemon: rotated server-side generations. Before each `PUT /state` overwrite, the
  prior canonical file is snapshotted to `<file>.<ISO-timestamp>.bak` and pruned to
  `SYNC_KEEP_GENERATIONS` (default 10, `0` disables), independent of the atomic
  temp+rename write itself. Restore-from-generation procedure documented in
  `docs/deploy/README.md`.
- Sync daemon: a rejected (401) request now logs one stderr line — timestamp, remote
  address (honors `X-Forwarded-For` behind a reverse proxy), and path — never any part
  of the Authorization header or token.
- Sync protocol: optimistic concurrency (ETag / If-Match) on `/state`, closing a
  lost-update race — two devices pulling the same state and pushing concurrently could
  previously have the second push silently overwrite the first, with the first
  device's changes gone from canonical until it happened to sync again. `GET /state`
  now returns a strong `ETag` (sha256 hex of the exact stored bytes; a well-known
  empty-sentinel on 204-when-empty). `PUT /state` now REQUIRES `If-Match`: a missing
  precondition is `428 Precondition Required` and a stale one is
  `412 Precondition Failed` (not `409`) with the current etag on the response, both
  checked atomically with the write itself so two concurrent PUTs from the same base
  state always resolve to exactly one winner. There are zero deployed daemons for this
  protocol version, so this is a hard requirement with no legacy fallback — documented
  in `src/lib/node/sync-server.ts`'s file header and `docs/deploy/README.md`.
  `SyncTransport.pull()`/`push()` (both `InMemorySyncTransport` and
  `HttpSyncTransport`) carry the etag through; `syncOnce` retries a `412` by
  re-pulling, re-merging (the full merge machinery, including `sync-reconcile`, runs
  again), and re-pushing with the fresh etag, bounded to 3 total attempts before
  throwing a typed `SyncPushConflictError`.
- MCP server: `MCP_READ_ONLY=1` (or `true`) boots the server with the 4 write tools
  (`scale_recipe`, `create_recipe`, `log_reading`, `adjust_inventory`) unregistered
  entirely — absent from `tools/list`, not merely rejected at call time. Read tools are
  unaffected; default behavior (writes registered) is unchanged.
- `scripts/build-daemon.mjs` (`npm run build:daemon`) — bundles the sync daemon and MCP
  server into single-file ESM artifacts (`dist/sync-server.mjs`, `dist/mcp-server.mjs`,
  esbuild, node22 target, all dependencies including `@modelcontextprotocol/sdk`
  bundled). Production deploys now run `node dist/sync-server.mjs` directly — no `tsx`,
  no live-checkout `node_modules` on the serving path.
- Behavioral unit coverage for `public/sw.js`, the offline engine: install
  (versioned precache populated, `skipWaiting`), activate (stale cache versions
  deleted, clients claimed), and every fetch strategy (cache-first
  `/_next/static/`, navigation fallback chain to `/` then the offline 503,
  non-GET/cross-origin pass-through) — each asserted at the origin root AND
  under a subpath deploy, via a shared `node:vm` sandbox harness
  (`tests/unit/ui/sw-harness.ts`) that injects the precache exactly like the
  build does.
- Offline e2e smoke (`e2e/offline.spec.ts`): registers the real service worker
  against the production build, waits for the precache, cuts the network, and
  proves the app shell reloads and navigates to `/calculators/` from cache —
  including the synthesized 503 for uncached requests.
- Golden-value tests pinning the safety-critical pressure calculators
  (force-carb, spunding incl. the MAWP cap, line balance, residual CO2) to
  published chart/table reference values with source citations, so a silent
  regression in pressure math fails loudly instead of shipping.

### Changed
- Backup envelope bumped to `DumpV9` (`DUMP_VERSION` 8→9; Dexie schema v10→v11),
  additive only — a v10 Dexie DB and v1..v8 dumps migrate forward losslessly
  (older dumps import with an empty tombstone set). Self-hosters: upgrade the
  sync daemon before or together with the app — `GET /health`'s
  `supportedDumpVersions` now advertises `[1..9]`.
- README states the real status of multi-device sync — now "end-to-end usable"
  with the in-app connection UI shipped (see Added above). The deploy runbook's
  STATUS callout and bring-up step 6 describe the Settings → Sync flow (the
  `curl` smoke-tests remain as an optional pre-check), and a new "Cross-origin
  apps (`SYNC_ALLOWED_ORIGINS`)" section + `sync.env.example` entry document the
  opt-in CORS story, including why the same-origin Caddy deploy needs none.
- `docs/deploy/`: `beer-lab-sync.service` now runs the pre-built `dist/sync-server.mjs`
  bundle instead of `npx tsx`; the `Caddyfile` adds baseline security headers
  (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, a `frame-ancestors`
  `Content-Security-Policy` — the one directive the app's build-time meta CSP can't
  express — and a minimal `Permissions-Policy`) and proxies `/health` alongside
  `/state`; `README.md` documents the exact token-hash algorithm, rotation procedure,
  `SYNC_KEEP_GENERATIONS`/restore-from-generation, and `/health` for uptime monitoring.

### Fixed
- `docs/mcp.md` referenced a stale dump-envelope version (v6); the current
  envelope is v8.
- `docs/deploy/sync.env.example`'s token-hash one-liner copied `shasum`'s raw output
  (including its trailing filename marker), which fails the daemon's hash-format check
  and is silently dropped from `SYNC_TOKEN_HASHES`; it now pipes through `cut` to match
  exactly what the daemon computes.
- Sync client: two devices concurrently deducting the same inventory item (each
  locally consistent alone) could union to a negative ledger sum on merge. The
  merge silently clamped the displayed `amount` to 0 without touching the
  ledger, so `amount !== Σdeltas` — every subsequent push then failed the sync
  daemon's ledger-invariant check (400) **forever**, with no way to un-wedge.
  Worse, the merged (already-broken) dump was restored into the local DB
  *before* the push, and the data doctor's auto-fix explicitly refuses to
  repair a negative ledger sum — so there was no recovery path. `syncOnce` now
  (1) reconciles instead of clamping: it appends a deterministic
  `sync-reconcile` compensating transaction that brings `Σdeltas` back to the
  non-negative floor, so `amount === Σdeltas` holds exactly, and (2) snapshots
  the local state (reusing the existing backup rotation) immediately before
  any merge restore, so a bad merge is always recoverable. The reconciliation
  id is derived only from the item id and the sorted ids of the transactions
  it reconciles — never wall-clock or device input — so two devices that
  independently reconcile the same conflict produce byte-identical
  transactions that converge to one on the next merge, instead of drifting
  apart or double-compensating.

## [0.1.0] — 2026-07-13

Initial public release. Dexie schema **v10**, backup envelope **DumpV8**,
1,626 unit/integration tests, Playwright e2e, build-time hash CSP.

- Recipes with live OG/FG/ABV/IBU/SRM math, BJCP style overlays, BeerXML import.
- Guided brew day (mash → boil → fermentation → packaging) with configurable
  equipment.
- Fermentation logging with interactive charts.
- Inventory with an append-only stock ledger and brew-day auto-deduction.
- Yeast Bank: harvest → repitch lineage tracking with viability estimates.
- Water chemistry with ion targets and comparison.
- Optional BYO-key AI companion (read tools + human-approved proposals).
- MCP stdio server and self-hosted sync daemon (client UI pending).
