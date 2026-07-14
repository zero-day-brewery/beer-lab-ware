# Contributing to Beer-Lab-Ware

Thanks for your interest in improving Beer-Lab-Ware. This is a small, local-first project — contributions of any size are welcome, from typo fixes to new features.

## Getting set up

```bash
npm install
npm run dev
```

This starts a dev server with hot reload at `http://localhost:3000`.

## Running the checks

Before opening a PR, please make sure the following all pass locally:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the unit and integration suite. **Tests must stay green** — if your change affects behavior, add or update a test alongside it rather than relying on manual verification alone.

`npm run build` produces the static export (`out/`) that the app ships as. If it fails, the PR isn't ready.

## Opening a PR

- Keep PRs focused — one logical change per PR is easier to review than a bundle of unrelated fixes.
- Write a clear description of what changed and why.
- Reference any related issue.
- Be ready for a round of review feedback; this is a young project and conventions are still settling.

That's it — open an issue first if you want to discuss a larger change before writing code, or just send the PR.
