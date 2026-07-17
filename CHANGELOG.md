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
  device's stale, pre-delete copy; two-way sync itself is still pending
  in-app connection UI (see README). A still-live inventory item whose ENTIRE
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
- README now states the real status of multi-device sync: the daemon and client
  library ship and are tested, the in-app connection UI is on the roadmap. The
  deploy runbook smoke-tests with `curl` instead of an app step that didn't
  exist, and carries a STATUS callout.
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
