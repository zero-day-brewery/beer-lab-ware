# Brand Assets — "Generation Trail" (shipped 2026-07-13)

The mark: three yeast generations budding diagonally (mother → daughter → granddaughter), amber fading to cyan — the repitch lineage the Yeast Bank tracks. Keep 3 generations in any redesign.

## Canonical geometry
`src/components/brand/brand-mark.tsx` — theme-aware React components (`BrandMark` full 3-cell, `BrandMarkSmall` 2-cell for ≤32px) + the token constants (`BRAND_AMBER`/`BRAND_CYAN`/`BRAND_FOAM`). All other copies are hand-synced duplicates of this geometry.

## In-app illustrations
`src/components/brand/empty-scenes.tsx` — 4 empty-state scenes (recipes book+flask · inventory shelf+sack · yeast mother-cell+ghost-bud · logbook carboy+flatline). Theme-token colors, decorative (aria-hidden).

## Static masters (fixed palette: amber #ffab2e · cyan #2ee6ff · foam #ffe1b3 · ground #0c0f13)
| File | Ground | Role |
|---|---|---|
| `public/icons/icon.svg` | transparent | purpose-`any` PWA icon master |
| `public/icons/icon-maskable.svg` | opaque #0c0f13, mark in 80% safe zone | maskable master |
| `public/icons/icon-small.svg` | transparent | 2-cell favicon source |
| `docs/assets/hero.svg` | opaque #0c0f13 | README hero master (only home of the interpunct BEER·LAB·WARE wordmark) |

## Generated + committed (rebuild: `node scripts/gen-brand-icons.mjs`)
`public/icons/`: icon-192.png, icon-512.png (transparent) · icon-maskable-192.png, icon-maskable-512.png, apple-touch-icon.png (opaque) · favicon-32.png (transparent) — plus `src/app/favicon.ico` (16+32 ICO) and `docs/assets/hero.png` (1280×400).

## Wiring (update if filenames ever change)
- `src/app/layout.tsx` → `metadata.icons` (favicon-32 first = tab icon, then icon-192; apple-touch)
- `public/manifest.webmanifest` → any/maskable icon entries (purpose split is test-protected)
- App-shell brand glyphs render `BrandMarkSmall` at 20px (mobile topbar) / 22px (sidebar)

## Regeneration rules
1. Redesign → update BOTH `brand-mark.tsx` (token colors) AND the static masters (fixed palette), keep filenames.
2. Run `node scripts/gen-brand-icons.mjs` (uses transitive `playwright` — never add it as a dependency).
3. Keep purpose-`any` PNGs transparent and maskables opaque — `tests/unit/storage/manifest.test.ts` guards the split.
4. Gates: `npm run typecheck && npm run lint && npm test && rm -rf out && npm run build`, then 6-theme visual QA.
