# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub's private vulnerability
reporting on this repository (*Security* tab → *Report a vulnerability*). Do not
open a public issue for anything you believe is exploitable.

You'll get a response as fast as a small maintainer team can manage — typically
within a few days. Please include reproduction steps and the affected component
(app, MCP server, or sync daemon).

## Supported versions

This project is pre-1.0. Only the **latest release** (and `main`) receives
security fixes.

## Threat model (short form)

Beer-Lab-Ware has three distinct components with very different exposure:

### 1. The PWA (browser app)
- **Data:** everything lives in the browser's IndexedDB/localStorage. There is no
  server component and no account; the app never transmits brewery data anywhere
  on its own.
- **Hardening:** the static build injects a hash-based Content-Security-Policy
  (no `unsafe-eval`, self-verifying at build time — `scripts/inject-csp.mjs`).
  The AI companion's markdown rendering is XSS-guarded and dependency-free.
- **BYO-AI key:** stored in localStorage by design and deliberately **excluded
  from backups/exports** (covered by a regression test). When the companion is
  used, prompt data goes directly from the browser to the provider the user
  configured — never through project infrastructure.
- **Main risks to users:** malicious backup/import files (imports are Zod-guarded
  and version-checked), and untrusted forks/hosts serving modified builds — only
  install from a source you trust.

### 2. The MCP server (`src/lib/node/mcp-server.ts`)
- Runs **locally over stdio** for AI-client integration; it is not a network
  service. Write tools mutate a local `brewery.json` and are flagged for
  client-side approval gating.

### 3. The self-hosted sync daemon (`src/lib/node/sync-server.ts`)
- Optional, operated by the user. Binds `127.0.0.1` and expects a reverse proxy
  for TLS. Auth is mandatory hashed Bearer tokens compared with
  `timingSafeEqual`; payloads are Zod-validated and must pass the ledger
  invariant before an atomic write.
- **The operator owns:** TLS termination, network exposure decisions, token
  generation/rotation, host patching, and backups of the canonical state file.
  See [`docs/deploy/`](./docs/deploy/README.md).

## Out of scope

- Vulnerabilities requiring a compromised device/browser profile.
- Issues in a self-hoster's own proxy, TLS, or network configuration.
- The security of third-party AI providers a user configures.
