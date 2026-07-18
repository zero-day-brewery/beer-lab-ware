// scripts/build-daemon.mjs — bundle the Node-only daemon entrypoints into
// single-file ESM artifacts under dist/, so a production deploy runs
// `node dist/sync-server.mjs` / `node dist/mcp-server.mjs` directly — no tsx,
// no node_modules tree required at runtime beyond what Node itself needs. Run:
//   node scripts/build-daemon.mjs
// or:
//   npm run build:daemon
//
// Both entrypoints bundle EVERY dependency, including @modelcontextprotocol/sdk
// — verified 2026-07-16 to bundle cleanly with esbuild (no dynamic requires, no
// native bindings, no warnings), so nothing is marked external. If a future SDK
// version breaks that, mark it external here and document why in
// docs/deploy/README.md (the "Building the daemon" section has a slot for this).
//
// dist/ is gitignored — this script (not source control) is the source of truth
// for the deployed bundle. Re-run after every source change before deploying.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const SRC_ALIAS_TARGET = fileURLToPath(new URL('../src', import.meta.url))

const ENTRIES = [
  { in: 'src/lib/node/sync-server.ts', out: 'dist/sync-server.mjs' },
  { in: 'src/lib/node/mcp-server.ts', out: 'dist/mcp-server.mjs' },
]

for (const { in: entryPoint, out: outfile } of ENTRIES) {
  const result = await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: false,
    sourcemap: false,
    alias: { '@': SRC_ALIAS_TARGET },
    metafile: true,
    logLevel: 'info',
  })
  const bytes = result.metafile.outputs[outfile]?.bytes ?? 0
  console.log(`build-daemon: ${entryPoint} -> ${outfile} (${(bytes / 1024).toFixed(1)} KiB)`)
}
