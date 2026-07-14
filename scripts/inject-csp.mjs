import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = 'out'
const VERIFY_ONLY = process.argv.includes('--verify-only')

// Inline <script> (no src attribute) → capture the verbatim body. React never emits a raw
// </script> inside inline scripts (it escapes to <\/script>), so non-greedy matching is exact.
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi
const CSP_META = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi
// React serializes the charset prop as `charSet` — match case-insensitively.
const CHARSET_META = /<meta[^>]*charset=["'][^"']*["'][^>]*\/?>/i

/** Base directives, in order. script-src hashes are appended per page. */
function directives(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

function htmlFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((p) => typeof p === 'string' && p.endsWith('.html'))
    .map((p) => join(dir, p))
}

function inlineHashes(html) {
  const hashes = []
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    const body = m[1]
    if (body.includes('</script')) {
      throw new Error('inject-csp: inline script contains a literal </script> — extraction unsafe')
    }
    // Hash the exact UTF-8 bytes the browser executes.
    const digest = createHash('sha256').update(body, 'utf8').digest('base64')
    hashes.push(`'sha256-${digest}'`)
  }
  return hashes
}

function injectFile(file) {
  const original = readFileSync(file, 'utf8')
  const html = original.replace(CSP_META, '') // idempotent: drop any prior CSP meta first
  const hashes = inlineHashes(html)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${directives(hashes)}">`
  const charset = html.match(CHARSET_META)
  if (!charset) throw new Error(`inject-csp: no <meta charset> found in ${file}`)
  const at = html.indexOf(charset[0]) + charset[0].length
  const injected = html.slice(0, at) + meta + html.slice(at)
  writeFileSync(file, injected)
}

/** Re-read from disk and prove every inline-script hash is present in that page's CSP. */
function verifyFile(file) {
  const html = readFileSync(file, 'utf8')
  const errors = []
  const cspMeta = html.match(CSP_META)
  if (!cspMeta) return [`${file}: no CSP <meta> present`]
  const csp = cspMeta[0]

  // Charset must precede CSP and stay inside the first-1024-byte window.
  const charset = html.match(CHARSET_META)
  if (!charset) errors.push(`${file}: no <meta charset>`)
  else {
    const charsetAt = html.indexOf(charset[0])
    if (charsetAt >= 1024) errors.push(`${file}: charset at byte ${charsetAt} (>=1024)`)
    if (html.indexOf(csp) < charsetAt) errors.push(`${file}: CSP meta precedes charset`)
  }

  for (const [i, hash] of inlineHashes(html).entries()) {
    if (!csp.includes(hash)) errors.push(`${file}: inline script #${i + 1} hash ${hash} missing from script-src`)
  }
  return errors
}

const files = htmlFiles(OUT_DIR)
if (!VERIFY_ONLY) {
  for (const f of files) injectFile(f)
}
let scriptCount = 0
const allErrors = []
for (const f of files) {
  scriptCount += inlineHashes(readFileSync(f, 'utf8')).length
  allErrors.push(...verifyFile(f))
}
if (allErrors.length > 0) {
  console.error('CSP self-verification FAILED:')
  for (const e of allErrors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log(`CSP: ${VERIFY_ONLY ? 'verified' : 'injected +'} ${files.length} pages, ${scriptCount} inline scripts, 0 mismatches`)
