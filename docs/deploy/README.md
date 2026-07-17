# Sync back-end deploy

The **personal back-end** for Beer-Lab-Ware: a tiny always-on service that holds the
canonical brewery state so your devices sync. The **front-end stays the lightweight,
downloadable brewery assistant** — this back-end is the "step further" for personal use.

> **STATUS:** end-to-end usable. The app connects to this daemon from **Settings →
> Sync** — enter the server URL and a per-device token, **Test connection**, then
> **Sync now** (two-way by default; pull-only / push-only under Advanced). The
> **Diagnostics** page shows live reachability, dump-version compatibility, and an
> auth check against this daemon. If the app is served from a DIFFERENT origin than
> the daemon, see "Cross-origin apps (SYNC_ALLOWED_ORIGINS)" below.

> These are TEMPLATES. Swap in your own domain, server IP, storage paths, and users
> before deploying.

## Auth is MANDATORY — always

Every device needs a per-device Bearer token. There is no token-optional / LAN-trust
mode: `GET /state` and `PUT /state` reject every request without a valid
`Authorization: Bearer <token>` header, 401, before touching the filesystem —
regardless of whether the daemon is reachable only on your LAN, over your own VPN, or
publicly. Network reachability is defense-in-depth on top of auth, never a substitute
for it. The daemon won't even start without at least one token hash configured
(`SYNC_TOKEN_HASHES must list at least one sha256-hex device-token hash`).

The one exception is `GET /health` (see below) — deliberately unauthenticated, and it
never returns brewery data, so it isn't a hole in the above.

## Optimistic concurrency is MANDATORY on every PUT — ETag / If-Match

`PUT /state` requires an `If-Match` precondition, checked AFTER auth and body
validation but atomically with the write itself. This closes a lost-update race: two
devices pulling the same state and pushing concurrently would otherwise have the
second push silently overwrite the first, with the first device's changes gone from
canonical until it happened to sync again.

- `GET /state` returns a strong `ETag` — a quoted sha256 hex of the exact stored JSON
  bytes. When the store is empty, `GET` still returns an `ETag` on its `204`: the
  well-known sentinel `"empty"`, so a client's very first push goes through the exact
  same precondition path as every later one (no empty-store special case).
- `PUT /state` with **no** `If-Match` header → `428 Precondition Required`,
  `{ "error": "precondition-required" }`. There are zero deployed daemons for this
  protocol version, so this is a hard requirement from day one — no legacy
  token-optional-style fallback, the same posture as the mandatory-auth decision above.
- `PUT /state` with an `If-Match` that does **not** equal the CURRENT etag →
  `412 Precondition Failed` (never `409` — 412 is the correct HTTP status for a failed
  precondition), `{ "error": "precondition-failed" }`, and the response's `ETag`
  header carries the CURRENT etag so the rejected client can log/inspect what won
  without another `GET`. This covers a stale etag from an earlier `GET`/`PUT`, a
  content-shaped etag presented against an empty store, and the empty sentinel
  presented against a non-empty store — all are just "doesn't match current."
- `PUT /state` with a matching `If-Match` → `200`, and the response's `ETag` header
  carries the NEW etag for the next write.
- The precondition check and the write are both inside the daemon's write mutex, so
  two concurrent PUTs racing from the same base state always resolve to exactly one
  `200` and one `412` — never both succeeding, never a silent clobber.

## What's already built + tested (this repo)
- **`src/lib/node/sync-server.ts`** — the daemon.
  - `GET/PUT /state` — mandatory hashed Bearer auth (`timingSafeEqual`), 204-when-empty,
    envelope + ledger-invariant validation on PUT, atomic write behind a mutex, binds
    127.0.0.1. A rejected (401) request logs one stderr line — timestamp, remote
    address, path — and NEVER the token or any part of the Authorization header.
  - `PUT /state` also requires optimistic-concurrency `If-Match` (see above) — `428`
    when absent, `412` when stale, both checked atomically with the write.
  - `GET /health` — **unauthenticated**, `200 { ok, daemonVersion, supportedDumpVersions }`,
    never reads or leaks brewery data. For uptime monitoring (see below).
  - Before each `PUT` overwrites the canonical file, the prior generation is
    snapshotted to a `.bak` (`SYNC_KEEP_GENERATIONS`, see below) — independent of, and
    without weakening, the atomic temp+rename of the write itself.
- **`src/lib/node/brewery-store.ts`** — advanced to DumpV9 (matches the client, incl.
  `rowTombstones` for the sync merge's deletion tombstones) + the
  `assertLedgerInvariant` guard + `rotateGenerations` (the `.bak` snapshot/prune logic).
- **`public/sw.js`** — `/state` is never cached (would poison pulls).
- Tests: `tests/unit/node/{brewery-store,sync-server,sync-secret-exclusion}.test.ts`,
  `tests/unit/ui/sw-state-bypass.test.ts`.

## Files here
| File | Goes to | Purpose |
|---|---|---|
| `Caddyfile` | `/etc/caddy/Caddyfile` | Serve `out/` + reverse-proxy `/state` and `/health`, plus baseline security headers |
| `beer-lab-sync.service` | `/etc/systemd/system/` | Run the pre-built daemon bundle (`enable --now`) |
| `sync.env.example` | `/etc/beer-lab-ware/sync.env` (0600) | `BREWERY_FILE`, `SYNC_TOKEN_HASHES`, `SYNC_PORT`, `SYNC_KEEP_GENERATIONS`, `SYNC_ALLOWED_ORIGINS` |

## Building the daemon

The daemon and MCP server ship as source (`src/lib/node/*.ts`); production runs a
**pre-built single-file bundle**, not `tsx` against a live checkout:

```bash
npm ci
npm run build:daemon
# → dist/sync-server.mjs, dist/mcp-server.mjs (plain ESM, all deps bundled, node22 target)
```

Both bundles include `@modelcontextprotocol/sdk` — it bundles cleanly with esbuild (no
dynamic requires, no native bindings), so nothing is marked `external`. Re-run
`npm run build:daemon` after every source change and before every deploy; `dist/` is
gitignored, so the bundle is never committed — it's a build artifact, regenerated on
the server (or by your CI) from the checked-out source.

## Bring-up order
1. Provision a small always-on host (VM, container, or spare machine) that your
   devices can reach — LAN-only, over your own VPN, or public, your call.
2. Clone the repo to the host, then build the daemon bundle:
   ```bash
   git clone <your-fork-or-checkout> /srv/beer-lab-ware/app
   cd /srv/beer-lab-ware/app
   npm ci
   npm run build:daemon
   ```
3. Run the sync server behind any reverse proxy (Caddy/nginx/Traefik); point the
   app at `https://<your-domain>`. Caddy's automatic HTTPS handles the cert for
   a public domain; use your own CA/cert for an internal-only name.
4. Generate the first per-device token + its hash (see "Token lifecycle" below), add
   the hash to `sync.env`.
5. `systemctl enable --now caddy beer-lab-sync`; reboot the host once to prove
   both services come back up and the cert is reused.
6. Connect the app: **Settings → Sync** → server URL (`https://<your-domain>`) +
   the device's plaintext token → **Test connection** (green = reachable +
   dump-version compatible) → **Sync now**. Optionally smoke-test the endpoints
   directly with curl first — this also exercises the optimistic-concurrency
   contract (see above) end-to-end:

   ```bash
   curl -s https://<your-domain>/health
   # expect: 200 {"ok":true,"daemonVersion":"0.1.0","supportedDumpVersions":[1,2,3,4,5,6,7,8,9]}

   curl -i -H "Authorization: Bearer <your-token>" https://<your-domain>/state
   # expect: 204 No Content before the first push (with `etag: "empty"`); 401 without/with a bad token

   # A PUT with no If-Match is rejected outright — no legacy fallback:
   curl -i -X PUT -H "Authorization: Bearer <your-token>" \
     -H "Content-Type: application/json" -d '{}' https://<your-domain>/state
   # expect: 428 Precondition Required {"error":"precondition-required"}

   # The first-ever PUT echoes back the empty-sentinel etag GET just reported:
   curl -i -X PUT -H "Authorization: Bearer <your-token>" -H 'If-Match: "empty"' \
     -H "Content-Type: application/json" --data @your-export.json https://<your-domain>/state
   # expect: 200 {"ok":true}, response ETag header is the new content etag — save it

   # Re-running the SAME PUT with the now-stale "empty" precondition is rejected:
   curl -i -X PUT -H "Authorization: Bearer <your-token>" -H 'If-Match: "empty"' \
     -H "Content-Type: application/json" --data @your-export.json https://<your-domain>/state
   # expect: 412 Precondition Failed {"error":"precondition-failed"}, response ETag is the CURRENT (new) one

   curl -i -H "Authorization: Bearer <your-token>" https://<your-domain>/state
   # expect: 200 + your export back verbatim, ETag header matches what the successful PUT returned
   ```

## Token lifecycle

The daemon never sees or stores a plaintext token — only its sha256-hex hash,
compared with `timingSafeEqual` (`sha256Hex` in `src/lib/node/sync-server.ts`). Getting
the hash algorithm exactly right matters: it's `sha256(token_bytes_utf8)`, hex-encoded,
lowercase, no trailing whitespace or extra characters.

**Generate a token + its hash** (run on a trusted machine, e.g. your laptop, never
the untrusted device itself):

```bash
TOK=$(openssl rand -hex 32)
echo "token (give to the device): $TOK"
printf '%s' "$TOK" | shasum -a 256 | cut -d' ' -f1   # → the hash to add to SYNC_TOKEN_HASHES
```

`printf '%s'` (not `echo`) matters — it emits the token with no trailing newline, so the
hash matches exactly what `sha256Hex()` computes over the raw Bearer value the device
sends. `cut -d' ' -f1` strips `shasum`'s trailing `  -` filename marker; copying the
untrimmed `shasum` output into `SYNC_TOKEN_HASHES` produces a value that fails the
daemon's `^[0-9a-f]{64}$` hash-format check and is silently dropped from the accepted
set (the daemon then either refuses to start, if it was the only hash, or simply never
accepts that device's requests) — always use the trimmed one-liner above.

**Add the device**: append the hash to the comma-separated `SYNC_TOKEN_HASHES` in
`sync.env`, restart the daemon (`systemctl restart beer-lab-sync`), give the device its
plaintext token (out of band — never over an unauthenticated channel). The token itself
lives only in the device's local storage; it is never a synced/backed-up field (see
`tests/unit/node/sync-secret-exclusion.test.ts`).

**Rotate a token** (e.g. a device was lost, or you rotate on a schedule):
1. Generate a NEW token + hash as above.
2. Add the new hash to `SYNC_TOKEN_HASHES` **alongside** the old one (comma-separated) —
   don't remove the old hash yet.
3. `systemctl restart beer-lab-sync` so the daemon accepts both old and new tokens.
4. Move the device over to the new plaintext token.
5. Once every device that used the old token has confirmed working on the new one,
   delete the OLD hash from `SYNC_TOKEN_HASHES` and restart again — this is the
   revocation step; a hash removed from the list is rejected on the very next request.

**Revoke a device immediately** (lost/compromised device, no replacement token needed
yet): delete its hash from `SYNC_TOKEN_HASHES`, restart the daemon. No grace period —
the very next request with that token 401s.

## Cross-origin apps (`SYNC_ALLOWED_ORIGINS`) — opt-in CORS

**The reference deploy in this folder does not need this.** With the Caddyfile here,
the app (`out/`) and the daemon (`/state`, `/health`) are served from the SAME origin,
so the browser never makes a cross-origin request and no CORS headers are needed —
and by default the daemon emits none, exactly as before this option existed.

You need it exactly when the **app is served from a different origin than the
daemon** — e.g. an installed PWA from a hosted/demo instance (GitHub Pages, another
domain) pointed at your self-hosted daemon. Without it the browser blocks those
requests before they reach auth, and Settings → Sync reports the server unreachable.

Set `SYNC_ALLOWED_ORIGINS` in `sync.env` to a comma-separated list of **exact**
origins (scheme://host[:port] — no paths, no trailing slash):

```bash
SYNC_ALLOWED_ORIGINS=https://app.example.com,https://your-name.github.io
```

Behavior when set:

- A request whose `Origin` exactly matches an allowlisted entry gets
  `Access-Control-Allow-Origin: <that origin>` (echoed, never `*`), `Vary: Origin`,
  and `Access-Control-Expose-Headers: ETag` — the client's optimistic-concurrency
  loop needs to READ the `ETag` header cross-origin.
- A non-matching `Origin` gets **no CORS headers at all** — the browser refuses the
  response to that page. (Non-browser clients like curl are unaffected either way;
  auth is what actually gates data.)
- `OPTIONS` preflight → `204` **without auth** (browsers send preflights without
  credentials by design), advertising `GET,PUT,OPTIONS`, the headers
  `Authorization,Content-Type,If-Match`, and a 24 h `Access-Control-Max-Age`. A
  preflight never reads or returns brewery data.
- **Auth is never relaxed:** an allowlisted origin still gets `401` on `/state`
  without a valid Bearer token. CORS only opens the browser's origin boundary; the
  token stays the gate.

**No wildcard support, deliberately.** `SYNC_ALLOWED_ORIGINS=*` (or any `*` entry)
refuses to start. This daemon holds one person's full brewery state behind a Bearer
token; reflecting arbitrary origins would tell every website's JavaScript "you may
read this server's responses", reducing the browser's origin boundary — the defense
that still holds if a token ever leaks into a page context — to a no-op. List the
one or two exact origins you actually serve the app from.

## Generation backups (`SYNC_KEEP_GENERATIONS`)

Before each `PUT /state` overwrites the canonical `brewery.json`, the daemon snapshots
the file it's about to replace to `<file>.<ISO-timestamp>.bak` (colon-free, second
precision — e.g. `brewery.json.2026-07-16T101500Z.bak`), then prunes the oldest
snapshots so at most `SYNC_KEEP_GENERATIONS` remain (default **10**; set to `0` to
disable generation backups entirely). The very first PUT to a fresh install makes no
backup — there's nothing prior to snapshot yet. This is independent of, and never
weakens, the atomic temp+rename of the main write: a backup failure never corrupts or
blocks the canonical write, and the canonical file is never left partially written.

**Restore from a generation** (e.g. a buggy client pushed bad-but-valid data and you
want the state from before that push):

```bash
systemctl stop beer-lab-sync                 # avoid a write racing the restore
cd /var/lib/beer-lab-ware                    # or wherever BREWERY_FILE lives
ls -1 brewery.json.*.bak                     # names sort chronologically (fixed-width timestamp)
cp brewery.json brewery.json.pre-restore.bak # keep the current state too, just in case
cp brewery.json.<the-generation-you-want>.bak brewery.json
systemctl start beer-lab-sync
```

Every device pulls the restored state on its next sync (client-side merge still
applies — a device with newer local changes than the restored generation will merge
them back in on its next `syncOnce`, so a true rollback may also require clearing or
overriding local state on each device; this restores the SERVER's canonical copy).

## Uptime monitoring (`GET /health`)

`GET /health` is unauthenticated by design (no Bearer token needed) and never reads or
returns brewery data — safe to point any external uptime checker (UptimeRobot,
Healthchecks.io, a Caddy/nginx-level probe, your own cron+curl) directly at
`https://<your-domain>/health`:

```bash
curl -s https://<your-domain>/health
# {"ok":true,"daemonVersion":"0.1.0","supportedDumpVersions":[1,2,3,4,5,6,7,8,9]}
```

`daemonVersion` is the running daemon's `package.json` version (useful for confirming a
deploy actually picked up a new build); `supportedDumpVersions` is the set of
backup-envelope versions this daemon build can read — compare it against the envelope
version your app version writes if you ever see sync rejections after upgrading only
one side (see the changelog's "Data-migration guarantee" / "Self-hosters" notes at the
repo root).

## Reach
This is designed for personal, self-hosted use: your devices talking to a server
you control. Whether that's LAN-only, over your own VPN/tunnel, or exposed
publicly behind auth is entirely a function of your own network — nothing here
assumes one topology over another. Auth (see above) is mandatory regardless of topology.
