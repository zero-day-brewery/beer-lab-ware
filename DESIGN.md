# Beer-Lab-Ware — Design Contract

Two locked looks share one token-driven component layer:

1. **Metal-Cyberpunk (the app default, §0)** — a cyberpunk brewhouse as a brushed-steel instrument panel. Cold gunmetal + cyan UI, warm wort-amber data.
2. **Craft Taproom (`default` theme, §1 onward)** — the original dark craft-taproom: espresso-black room, malt-amber & copper glow, cream "foam" highlights, characterful brewery-label serif.

Both — plus `matrix` / `cyberpunk` / `neon` / `soundwave` — are switchable at runtime. **Read this before building or restyling any page so the look stays locked.**

> Source of truth for tokens: `src/themes/<name>.css` (one `html[data-theme="<name>"]` block of custom properties each). Shared components: `src/app/globals.css`. Components read `var(--token)` only — never hardcode hex/HSL — so every theme keeps working. This file is the design intent behind them — keep them in sync.
>
> A self-contained design-system bundle (palette, 6-theme comparison, type, buttons/forms/cards/nav/status, atmosphere preview cards) exists, verified token-faithful against this contract. Re-extract changed cards after any token/theme change here.

---

## 0. Metal-Cyberpunk — the default theme ("cold machine, warm wort")

The app boots in `metal-cyberpunk`. Concept: a **cold machine brewing a warm liquid**. That split is the governing law of the theme:

- **CYAN `#2ee6ff` (hsl 189 100% 59%) = the machine.** `--primary`/`--ring`. All UI chrome: buttons, focus rings, active nav, gauge needles, pipes/pulses, the temperature line. One accent — never introduce a competing chrome hue.
- **WORT-AMBER `#ffab2d` (hsl 36 100% 59%) = the beer.** `--wort`/`--malt`. Every beer/gravity readout: gravity numbers, the gauge **value + range-band fill**, the fermentation gravity curve, trend sparklines. If it's brew *data*, it glows amber.
- **HOP-GREEN `#79f06a` (`--hop`) & EMBER `#ff5340` (`--destructive`) = semantic status ONLY** (in-range / warn-critical). Never the identity accent, never decoration.
- **Steel base:** void steel `#0b0e11` (`--background`), gunmetal panels `#141a20` (`--card`), seams `#232b34` (`--border`), cool steel highlight `--foam` (was warm cream). Harder radius `--radius: 0.4rem`.
- **SRM ramp stays realistic** (straw → black) — it's literal beer color, not recolored.

**Typography:** display/headings use **Archivo** (700–900), set **UPPERCASE with an engraved stamp** (`text-shadow: 0 1px 0 rgba(255,255,255,.05), 0 -1px 1px rgba(0,0,0,.7)`). Body stays **Hanken Grotesk**, all numerals stay **Geist Mono**. The face swap is done for this theme only by repointing `--font-fraunces → var(--font-archivo)` in `metal-cyberpunk.css`; the other themes keep Fraunces.

**Atmosphere:** the warm film-grain + amber radials are replaced (scoped) by faint **CRT scanlines**, a subtle **brushed-steel sheen**, and a **duotone ambient glow** — cyan top-right, wort bottom-left.

**Where it lives / how it stays isolated:** tokens in `src/themes/metal-cyberpunk.css` (custom properties only). *All* bespoke decoration (scanlines, sheen, rivets, engraved type, wort-line tap strip, gauge value/band/needle, hop/ember status) is scoped under `html[data-theme="metal-cyberpunk"]` in `globals.css` so the other five themes are visually untouched. Two documented non-token exceptions still apply: the hardcoded status/fermenter colors in `globals.css` (overridden in theme scope here, not globally) and `themeColor` in `layout.tsx` (now cyan `#2ee6ff`; overwritten at runtime from the active theme's `--primary`).

**Gauge decouple:** the vital-stat needle reads `--gauge-marker` (cyan) with a `var(--vc)` fallback, so the marker can be cyan while the band stays wort-amber; other themes leave `--gauge-marker` undefined and behave exactly as before. Status is also conveyed by an arrow glyph + text (WCAG 1.4.1), not color alone.

---

## 1. Visual Theme & Atmosphere — Craft Taproom (`default`)

Moody, premium craft taproom after close — warm and tactile, not sterile dashboard, not neon cyber. Dark espresso room lit by a malt-amber glow, copper hardware, cream beer-foam accents, a faint printed-label grain over everything. Warm and characterful, but restrained — the tone carries it, not gimmicks.

Mood words: warm, premium, tactile, low-lit, characterful, brewed-not-built.

## 2. Color Palette & Roles

HSL is the source of truth (theme uses `hsl()` custom properties). One amber accent owns each viewport.

```
--background:   hsl(28 22% 6%)    /* espresso black, warm not gray */
--foreground:   hsl(38 30% 90%)   /* warm cream ink */
--card:         hsl(26 18% 10%)   /* lifted charcoal plank */
--popover:      hsl(26 20% 9%)
--primary:      hsl(32 88% 55%)   /* MALT AMBER — the signature glow */
--secondary:    hsl(26 16% 16%)
--muted:        hsl(26 14% 14%)
--muted-foreground: hsl(34 14% 64%)  /* warm taupe */
--accent:       hsl(28 30% 18%)   /* deep bronze, hovers/surfaces */
--destructive:  hsl(8 62% 48%)    /* muted brick — warm, never alarm-red */
--border:       hsl(30 16% 19%)
--input:        hsl(30 16% 17%)
--ring:         hsl(32 88% 55%)

/* taproom extras */
--foam:    hsl(42 46% 90%)   /* cream head — highlights, gradient text */
--copper:  hsl(24 70% 48%)   /* darker rim / hop accents */
--malt:    hsl(36 78% 56%)   /* secondary amber */
```

**Status / signal colors** (used for fermenter stages, conditions, alerts — kept warm and slightly desaturated to sit in the dark room):
```
green/go:  hsl(140 55% 60%)   amber/warn: var(--malt)   brick/bad: hsl(8 78% 66%)
```

**Per-fermenter signature colors** (each vessel owns one when active — never reuse for anything else):
```
F1 amber  hsl(36 92% 58%)   F2 teal hsl(172 68% 48%)   F3 violet hsl(266 72% 66%)   F4 rose hsl(342 80% 63%)
```

Rules: amber is the *only* primary accent — don't introduce competing hues for chrome. Destructive stays brick, not red. Status/fermenter colors are for data, not decoration. Tint glows with `color-mix(in oklab, …)` against theme vars so they read in the dark.

## 3. Typography Rules

- **Display / headings (`h1`–`h3`, brand):** `Fraunces` (warm characterful serif), weight 600, letter-spacing −1.5%. This is the brewery-label voice. Loaded as `--font-fraunces`.
- **Body / UI:** `Hanken Grotesk` (clean humanist grotesk, not generic), weight 400/500. `--font-hanken`, mapped to `--font-sans`.
- **Mono / numerals (stats, gravities, prices, serials):** `Geist Mono`, tabular. `--font-geist-mono`. Use for every number that's data.
- **Eyebrow labels:** Hanken, 0.66–0.7rem, weight 700, `letter-spacing: 0.2em`, uppercase, colored with `color-mix(--malt, --foreground)`. Use the `.eyebrow` class.

Never: Inter/Roboto/Arial/system-ui for display, generic sans headings, or a serif body. Fraunces "Organic/warm" is reserved to this brand.

## 4. Component Stylings

Reuse the existing classes in `globals.css` — don't reinvent. Key patterns:

**Buttons**
- Primary action → `.btn-primary`: amber fill, espresso text, soft amber shadow, lifts 1px on hover.
- Quiet/secondary → `.btn-ghost` (add `.danger` for brick-tinted destructive).

**Cards**
- Content/gear/equipment → `.tap-card`: warm charcoal, a **copper→malt top strip** (`::before`), lifts 3px + amber shadow on hover.
- Plain surfaces → `--card` bg, `--border`, radius `var(--radius)` (0.7rem base).

**Inputs / selects** → `.field`: translucent card bg, `--input` border, **amber focus ring** (`box-shadow 0 0 0 3px color-mix(--primary 18%)`). Hide number spinners for vitals.

**Icon tile** → `.chip-icon`: rounded amber-tinted tile holding a category glyph/emoji.

**Status dots / pills** → `.cond` (gear condition) / `.flow-status` (live state): a glowing `currentColor` dot + uppercase label; add a pulse when live.

**Header** → `.app-header`: frosted bronze blur, amber-tinted bottom border, a glowing **`.header-foam`** gradient line under it. Brand wordmark `.brand-link`: Fraunces, foam→malt gradient-clipped text, glyph rotates on hover.

**Stat tiles** → `.stat-tile`: mono number in `--malt`, tiny uppercase label.

**Eyebrow** → `.eyebrow` (add `.center` for hero rules flanking the label).

## 5. Layout Principles

- App shell: centered `container`, generous `px-4 py-8`. Section headers use eyebrow → Fraunces `h1` → muted subtitle, divided by `border-b border-border/70 pb-6`.
- Card grids: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.
- Flow/diagram pages: left→right process with connector "pipes"; group related hardware in bordered subsystems.
- Negative space is warm and generous; density is fine for data tables/vitals as long as type weight separates levels.

## 6. Depth & Elevation

Depth comes from **warm light**, not gray shadows:
- Ambient: body carries layered radial gradients — malt glow from top, copper pour bottom-right, accent bottom-left (`background-attachment: fixed`).
- **Film grain**: a fixed `feTurbulence` SVG overlay at ~4% opacity, `mix-blend-mode: overlay` — gives surfaces a printed-label texture. Keep it.
- Active/hover states glow with `color-mix(--primary …)` amber shadows + a 1–3px lift. Idle elements dim to ~0.7 opacity rather than going flat-gray.
- Shadows are always warm-tinted (mix toward `--primary` or `#000`), never neutral gray.

## 7. Do's and Don'ts

**Do**
- Drive everything from the CSS custom properties so the 5 theme presets (default/matrix/cyberpunk/neon/soundwave) keep working — never hardcode hex in components.
- Use `color-mix(in oklab, var(--token) N%, transparent)` for glows, tints, borders.
- Put Fraunces on headings/brand, Geist Mono on every number, Hanken everywhere else.
- Lean on `.tap-card`, `.btn-primary/.btn-ghost`, `.field`, `.eyebrow`, `.stat-tile`, `.chip-icon`, `.cond`.
- Keep one amber accent per view; let fermenter/status colors carry data meaning only.

**Don't**
- Don't ship the stock shadcn light look, flat white cards, or gray neutral shadows.
- Don't use Inter/Roboto/Arial/system fonts, purple-on-white gradients, or generic AI-slop layouts.
- Don't add a second chrome accent competing with amber, or use alarm-red (use brick `--destructive`).
- Don't remove the grain or ambient glow — they're the atmosphere.
- Don't hardcode colors that break the theme switcher.
