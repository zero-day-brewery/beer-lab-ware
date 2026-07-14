# Sync back-end deploy

The **personal back-end** for Beer-Lab-Ware: a tiny always-on service that holds the
canonical brewery state so your devices sync. The **front-end stays the lightweight,
downloadable brewery assistant** — this back-end is the "step further" for personal use.

> These are TEMPLATES. Swap in your own domain, server IP, storage paths, and users
> before deploying.

## What's already built + tested (this repo)
- **`src/lib/node/sync-server.ts`** — the daemon. `GET/PUT /state`, mandatory hashed
  Bearer auth (`timingSafeEqual`), 204-when-empty, envelope + ledger-invariant
  validation on PUT, atomic write behind a mutex, binds 127.0.0.1. Run: `npm run sync`.
- **`src/lib/node/brewery-store.ts`** — advanced to DumpV8 (matches the client) + the
  `assertLedgerInvariant` guard.
- **`public/sw.js`** — `/state` is never cached (would poison pulls).
- Tests: `tests/unit/node/{brewery-store,sync-server,sync-secret-exclusion}.test.ts`,
  `tests/unit/ui/sw-state-bypass.test.ts`.

## Files here
| File | Goes to | Purpose |
|---|---|---|
| `Caddyfile` | `/etc/caddy/Caddyfile` | Serve `out/` + reverse-proxy `/state` |
| `beer-lab-sync.service` | `/etc/systemd/system/` | Run the daemon (`enable --now`) |
| `sync.env.example` | `/etc/beer-lab-ware/sync.env` (0600) | `BREWERY_FILE`, `SYNC_TOKEN_HASHES`, `SYNC_PORT` |

## Bring-up order
1. Provision a small always-on host (VM, container, or spare machine) that your
   devices can reach — LAN-only, over your own VPN, or public, your call.
2. Run the sync server behind any reverse proxy (Caddy/nginx/Traefik); point the
   app at `https://<your-domain>`. Caddy's automatic HTTPS handles the cert for
   a public domain; use your own CA/cert for an internal-only name.
3. `systemctl enable --now caddy beer-lab-sync`; reboot the host once to prove
   both services come back up and the cert is reused.
4. Generate the first per-device token, add its hash to `sync.env`, install the
   PWA on your phone, and confirm it can push/pull against the new origin.

## Reach
This is designed for personal, self-hosted use: your devices talking to a server
you control. Whether that's LAN-only, over your own VPN/tunnel, or exposed
publicly behind auth is entirely a function of your own network — nothing here
assumes one topology over another.
