// scripts/gen-brand-icons.mjs — one-shot brand-asset rasterizer. Run manually:
//   node scripts/gen-brand-icons.mjs
// NOT part of build/CI. Imports `playwright` (transitive dep of @playwright/test,
// hoisted by npm) — authorized undeclared import for this never-shipped script
// only; if hoisting ever breaks, regenerate is unnecessary (PNGs are committed).
// Canonical geometry: src/components/brand/brand-mark.tsx — keep the static masters below in sync by hand (see docs/brand-assets.md).
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const RENDERS = [
  { src: 'public/icons/icon.svg', out: 'public/icons/icon-192.png', w: 192, h: 192, transparent: true },
  { src: 'public/icons/icon.svg', out: 'public/icons/icon-512.png', w: 512, h: 512, transparent: true },
  { src: 'public/icons/icon-maskable.svg', out: 'public/icons/icon-maskable-192.png', w: 192, h: 192, transparent: false },
  { src: 'public/icons/icon-maskable.svg', out: 'public/icons/icon-maskable-512.png', w: 512, h: 512, transparent: false },
  { src: 'public/icons/icon-maskable.svg', out: 'public/icons/apple-touch-icon.png', w: 180, h: 180, transparent: false },
  { src: 'public/icons/icon-small.svg', out: 'public/icons/favicon-32.png', w: 32, h: 32, transparent: true },
  { src: 'docs/assets/hero.svg', out: 'docs/assets/hero.png', w: 1280, h: 400, transparent: false },
]

// ICO container: 6-byte header + one 16-byte dir entry per image + PNG payloads.
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = []
  const payloads = []
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    payloads.push(buf)
    offset += buf.length
  }
  return Buffer.concat([header, ...entries, ...payloads])
}

async function renderPng(page, { src, w, h, transparent }) {
  const svg = readFileSync(src, 'utf8')
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:${transparent ? 'transparent' : '#0c0f13'}}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
  )
  return page.screenshot({ omitBackground: transparent })
}

const browser = await chromium.launch()
const page = await browser.newPage()
for (const r of RENDERS) {
  writeFileSync(r.out, await renderPng(page, r))
  console.log(`gen-brand-icons: wrote ${r.out} (${r.w}x${r.h})`)
}
// favicon.ico = 16 + 32 layers from the small cut
const ico16 = await renderPng(page, { src: 'public/icons/icon-small.svg', w: 16, h: 16, transparent: true })
const ico32 = await renderPng(page, { src: 'public/icons/icon-small.svg', w: 32, h: 32, transparent: true })
writeFileSync('src/app/favicon.ico', buildIco([{ size: 16, buf: ico16 }, { size: 32, buf: ico32 }]))
console.log('gen-brand-icons: wrote src/app/favicon.ico (16+32)')
await browser.close()
