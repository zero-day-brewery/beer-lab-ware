# 🍺 Beer-Lab-Ware

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
- **Multi-device sync (optional, self-hosted):** if you want the same brewery data on more than one device, you can stand up a small self-hosted sync service. It's entirely optional — see [`docs/deploy/`](./docs/deploy/README.md) for the templates and runbook.

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

## License

MIT — see [`LICENSE`](./LICENSE).

---

Made for homebrewers — from Zero-Day Brewery.
