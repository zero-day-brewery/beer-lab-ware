import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPrecache, rewriteManifestForBase } from '../../../scripts/gen-sw-precache.mjs'

describe('buildPrecache', () => {
  it('collects html/static/icon/svg/manifest assets and excludes sw.js', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precache-'))
    mkdirSync(join(dir, '_next/static'), { recursive: true })
    mkdirSync(join(dir, 'icons'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html>a</html>')
    writeFileSync(join(dir, '_next/static/app.js'), 'console.log(1)')
    writeFileSync(join(dir, 'manifest.webmanifest'), '{}')
    writeFileSync(join(dir, 'icons/icon.svg'), '<svg/>')
    writeFileSync(join(dir, 'sw.js'), '// sw')

    const { entries, version } = buildPrecache(dir) as {
      entries: { url: string; revision: string }[]
      version: string
    }
    const urls = entries.map((e) => e.url)
    // <dir>/index.html maps to its directory URL (navigations are directory
    // URLs under trailingSlash:true) — NOT the bare file path.
    expect(urls).toContain('/')
    expect(urls).not.toContain('/index.html')
    expect(urls).toContain('/_next/static/app.js')
    expect(urls).toContain('/manifest.webmanifest')
    expect(urls).toContain('/icons/icon.svg')
    expect(urls).not.toContain('/sw.js')
    expect(entries.every((e) => /^[0-9a-f]{8}$/.test(e.revision))).toBe(true)
    expect(version).toMatch(/^[0-9a-f]{8}$/)
  })

  it('maps a nested <dir>/index.html to its directory URL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precache-nested-'))
    mkdirSync(join(dir, 'settings'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html>root</html>')
    writeFileSync(join(dir, 'settings/index.html'), '<html>settings</html>')

    const { entries } = buildPrecache(dir) as {
      entries: { url: string; revision: string }[]
    }
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('/')
    expect(urls).toContain('/settings/')
    expect(urls).not.toContain('/settings/index.html')
  })

  it('is deterministic for an identical tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precache2-'))
    writeFileSync(join(dir, 'index.html'), '<html>a</html>')
    const a = buildPrecache(dir) as { version: string }
    const b = buildPrecache(dir) as { version: string }
    expect(a.version).toBe(b.version)
  })

  it('prefixes every URL with the base path when one is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precache-base-'))
    mkdirSync(join(dir, 'settings'), { recursive: true })
    mkdirSync(join(dir, '_next/static'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html>root</html>')
    writeFileSync(join(dir, 'settings/index.html'), '<html>settings</html>')
    writeFileSync(join(dir, '_next/static/app.js'), 'console.log(1)')

    const { entries } = buildPrecache(dir, '/beer-lab-ware') as {
      entries: { url: string }[]
    }
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('/beer-lab-ware/')
    expect(urls).toContain('/beer-lab-ware/settings/')
    expect(urls).toContain('/beer-lab-ware/_next/static/app.js')
    expect(urls.every((u) => u.startsWith('/beer-lab-ware/'))).toBe(true)
  })
})

describe('rewriteManifestForBase', () => {
  it('prefixes id/start_url/scope/icon srcs and leaves the rest alone', () => {
    const manifest = {
      id: '/',
      name: 'Beer-Lab-Ware',
      start_url: '/',
      scope: '/',
      icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    }
    const out = rewriteManifestForBase(manifest, '/beer-lab-ware') as typeof manifest
    expect(out.id).toBe('/beer-lab-ware/')
    expect(out.start_url).toBe('/beer-lab-ware/')
    expect(out.scope).toBe('/beer-lab-ware/')
    expect(out.icons[0].src).toBe('/beer-lab-ware/icons/icon-192.png')
    expect(out.name).toBe('Beer-Lab-Ware')
  })
})
