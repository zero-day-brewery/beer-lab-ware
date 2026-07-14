import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROCESS_DIR = resolve(__dirname, '../../../src/lib/brewing/process')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })
}

// Runtime import detector: matches `import ... from '<mod>'` but NOT `import type ... from`.
const importLineRe = /^\s*import\s+(?!type\s)(.+?)\s+from\s+['"]([^'"]+)['"]/

const FORBIDDEN_MODULES = [/^dexie/, /^@\/lib\/db/, /^@\/stores\//, /^@\/components\//, /^next\//]
const FORBIDDEN_GLOBALS = /\b(document|window\.|fetch\(|navigator\.|localStorage|indexedDB)\b/

describe('process package purity', () => {
  const files = walk(PROCESS_DIR)

  it('finds the process package files', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = file.slice(file.indexOf('src/'))

    it(`${rel}: no forbidden runtime imports`, () => {
      for (const line of src.split('\n')) {
        const m = importLineRe.exec(line)
        if (!m) continue
        const mod = m[2]
        for (const bad of FORBIDDEN_MODULES) {
          expect(bad.test(mod), `runtime import of ${mod} in ${rel}`).toBe(false)
        }
      }
    })

    it(`${rel}: no DOM/Dexie/fetch global usage`, () => {
      // strip import lines (an `import type` referencing a name is fine)
      const body = src
        .split('\n')
        .filter((l) => !/^\s*import\s/.test(l))
        .join('\n')
      expect(FORBIDDEN_GLOBALS.test(body), `forbidden global in ${rel}`).toBe(false)
    })
  }
})
