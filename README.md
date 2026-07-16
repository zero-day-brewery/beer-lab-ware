# 🍺 Beer-Lab-Ware

[![CI](https://github.com/public-n0cs-code/beer-lab-ware/actions/workflows/ci.yml/badge.svg)](https://github.com/public-n0cs-code/beer-lab-ware/actions/workflows/ci.yml)
![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

![Beer-Lab-Ware hero banner](docs/assets/hero.png)

**A local-first homebrewing app for recipes, brew day, and fermentation — no account, no server, no subscription.**

Beer-Lab-Ware is a Progressive Web App for homebrewers who want real recipe math, a guided brew day, and fermentation tracking without handing their data to a cloud service. Everything lives in your browser by default; nothing is required to sign up, and nothing phones home.

## Features

- **Recipes** — a full recipe editor with real-time OG/FG/ABV/IBU/SRM calculations, BJCP style overlays, and BeerXML import/export.
- **Brew flow** — a guided, step-by-step brew day that walks you through mash, boil, and additions in order.
- **Fermentation logging + charts** — log gravity and temperature readings over the course of a fermentation and see them plotted.
- **Inventory** — track fermentables, hops, yeast, and misc ingredients, and draw them down as you brew.
- **Yeast Bank** — a harvest → repitch lineage tracker: capture a slurry harvest from a batch, follow it through generations, and see viability decay over time.
- **BYO-AI brewing companion** — an optional AI assistant that can answer questions about your recipes and batches and propose changes for you to review. Bring your own API key; see below.

## Runs anywhere, keeps working offline

Beer-Lab-Ware is a **static, local-first PWA**. There's no backend to stand up and no account to create — clone it, build it, and host the static output anywhere (or just run it locally). Install it to your phone or desktop home screen and it keeps working offline, brew day included.

## BYO-AI companion

The AI companion is opt-in. Bring your own API key — Anthropic or any OpenAI-compatible endpoint (including local model servers) — and it's stored in your browser's local storage. The key is never sent anywhere except directly to the provider you configured, and it never touches any server this project runs.

## Sync tiers

- **Local-only (default, for everyone):** your data lives in the browser's local database. No setup required.
- **Multi-device sync (self-hosted, in progress):** the sync daemon and the client sync library ship in this repo today and are fully tested — see [`docs/deploy/`](./docs/deploy/README.md) for the templates and runbook if you want to stand the service up ahead of time. **The in-app connection UI is still on the roadmap**, so the app can't be pointed at a sync server yet; sync becomes end-to-end usable when that lands (tracked in the changelog).

Local-first is permanent: any sync or hosted tier will always be optional, and the app will always work fully with no account and no server.

## Getting started (development)

```bash
npm install
npm run dev       # dev server with hot reload
```

Build a static export:

```bash
npm run build
```

## Contributing

Bug reports, feature ideas, and pull requests are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to get set up.

## License, terms & privacy

Code is MIT — see [`LICENSE`](./LICENSE). Style vital statistics are derived from
the [BJCP 2021 Style Guidelines](https://www.bjcp.org/style/2021/) and remain
subject to BJCP's terms — see [`NOTICE`](./NOTICE). The Beer-Lab-Ware name and
logo are project identity and are not covered by the MIT code grant.

Plain-language use terms (including the safety note on pressure calculators) are
in [`TERMS.md`](./TERMS.md). The privacy story — the app doesn't phone home — is
in [`PRIVACY.md`](./PRIVACY.md).

---

Made for homebrewers — from Zero-Day Brewery.
