# Contributing to Beer-Lab-Ware

Thanks for your interest in improving Beer-Lab-Ware. This is a small, local-first project — contributions of any size are welcome, from typo fixes to new features.

## Getting set up

You'll need **Node 22 or 24** (see `.nvmrc` — `nvm use` picks the right one).

```bash
npm install
npm run dev
```

This starts a dev server with hot reload at `http://localhost:3000`.

Formatting and linting are handled by [Biome](https://biomejs.dev/) — run
`npm run format` to auto-format and `npm run lint` to check. There's no separate
Prettier/ESLint setup.

## Running the checks

Before opening a PR, please make sure the following all pass locally:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

### End-to-end tests

The Playwright suite exercises the built static bundle (the thing that actually
ships), including the CSP and service worker:

```bash
npx playwright install chromium   # first time only
npm run build
npm run e2e
```

Run `npm run typecheck:e2e` if you touch anything under `e2e/`.

`npm test` runs the unit and integration suite. **Tests must stay green** — if your change affects behavior, add or update a test alongside it rather than relying on manual verification alone.

`npm run build` produces the static export (`out/`) that the app ships as. If it fails, the PR isn't ready.

## Opening a PR

- Keep PRs focused — one logical change per PR is easier to review than a bundle of unrelated fixes.
- Write a clear description of what changed and why.
- Reference any related issue.
- Be ready for a round of review feedback; this is a young project and conventions are still settling.

That's it — open an issue first if you want to discuss a larger change before writing code, or just send the PR.

## Licensing of contributions (DCO)

Contributions are accepted under the project's [MIT license](./LICENSE) —
**inbound = outbound**: by contributing, you agree your contribution is licensed
under the same MIT terms as the project.

We use the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) to make that explicit. Sign off every commit:

```bash
git commit -s
```

which adds a `Signed-off-by: Your Name <you@example.com>` trailer certifying you
have the right to submit the work under the project license. PRs with unsigned
commits will be asked to rebase.

## Trademark note

The MIT license covers the **code**. The **Beer-Lab-Ware name and logo** are the
project's identity and are not part of the code grant: forks are welcome and
encouraged, but please ship a modified or rebranded version under your own name
and mark, and don't present a fork as the official project. Nominative use
("based on Beer-Lab-Ware") is of course fine.
