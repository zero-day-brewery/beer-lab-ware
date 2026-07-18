import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUT = 'out'

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function shouldPrecache(rel) {
  return (
    rel.endsWith('.html') ||
    rel.startsWith('_next/static/') ||
    rel === 'manifest.webmanifest' ||
    rel.startsWith('icons/') ||
    rel.endsWith('.svg')
  )
}

function hash(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8)
}

// Map a built file path to the URL the browser actually requests. Under
// next.config trailingSlash:true, navigations are DIRECTORY urls (`/`,
// `/settings/`), so an `<dir>/index.html` file must be precached under its
// directory url or caches.match(navigateRequest) never hits. Non-index assets
// keep their file path. `base` prefixes every URL for subpath deploys.
function toUrl(rel, base) {
  if (rel === 'index.html') return `${base}/`
  if (rel.endsWith('/index.html')) return `${base}/${rel.slice(0, -'index.html'.length)}`
  return `${base}/${rel}`
}

export function buildPrecache(outDir = OUT, base = process.env.BASE_PATH ?? '') {
  const entries = []
  for (const abs of walk(outDir)) {
    const rel = relative(outDir, abs).split('\\').join('/')
    if (rel === 'sw.js' || !shouldPrecache(rel)) continue
    entries.push({ url: toUrl(rel, base), revision: hash(readFileSync(abs)) })
  }
  entries.sort((a, b) => a.url.localeCompare(b.url))
  const version = hash(Buffer.from(entries.map((e) => e.url + e.revision).join('|')))
  return { entries, version }
}

// The webmanifest ships root-rooted URLs. For a subpath deploy every URL field
// must carry the base prefix, and this must happen BEFORE the precache pass so
// the manifest's precache revision hashes the rewritten content.
export function rewriteManifestForBase(manifest, base) {
  const prefix = (u) => (typeof u === 'string' && u.startsWith('/') ? `${base}${u}` : u)
  return {
    ...manifest,
    id: prefix(manifest.id),
    start_url: prefix(manifest.start_url),
    scope: prefix(manifest.scope),
    icons: (manifest.icons ?? []).map((i) => ({ ...i, src: prefix(i.src) })),
  }
}

function main() {
  const base = process.env.BASE_PATH ?? ''
  if (base) {
    const manifestPath = join(OUT, 'manifest.webmanifest')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, `${JSON.stringify(rewriteManifestForBase(manifest, base), null, 2)}\n`)
  }
  const { entries, version } = buildPrecache(OUT, base)
  const swPath = join(OUT, 'sw.js')
  let sw = readFileSync(swPath, 'utf8')
  sw = sw.replace('/*__PRECACHE__*/[]/*__END__*/', JSON.stringify(entries))
  sw = sw.replace("'__VERSION__'", JSON.stringify(`beer-lab-ware-${version}`))
  writeFileSync(swPath, sw)
  console.log(
    `gen-sw-precache: ${entries.length} assets, version beer-lab-ware-${version}${base ? `, base ${base}` : ''}`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
