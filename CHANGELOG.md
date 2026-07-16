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
- `TERMS.md` (plain-language terms incl. safety notes for pressure calculators),
  `PRIVACY.md` (the app doesn't phone home; BYO-AI egress disclosed), `NOTICE`
  (BJCP 2021 attribution + model citations), `SECURITY.md` (private reporting +
  threat model), `CODE_OF_CONDUCT.md`, issue forms, and a PR template.
- In-app safety note on the carbonation/spunding/line-balance calculators.
- Contributor DCO sign-off policy and trademark note in `CONTRIBUTING.md`.
- Declared Node support: `engines` field + `.nvmrc` (Node 22/24).

### Changed
- README now states the real status of multi-device sync: the daemon and client
  library ship and are tested, the in-app connection UI is on the roadmap. The
  deploy runbook smoke-tests with `curl` instead of an app step that didn't
  exist, and carries a STATUS callout.

### Fixed
- `docs/mcp.md` referenced a stale dump-envelope version (v6); the current
  envelope is v8.

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
