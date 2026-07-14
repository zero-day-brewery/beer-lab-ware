import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DUMP_VERSION, makeBackupService } from '@/lib/db/backup'
import { parseAndGuardDump } from '@/lib/db/import-guard'
import { db } from '@/lib/db/schema'
import { FIXTURE_BATCH_ID, FIXTURE_RECIPE_NAME } from '../../e2e/fixtures/constants'

const fixtureText = readFileSync(
  path.resolve(__dirname, '../../e2e/fixtures/seed.dump.json'),
  'utf8',
)

describe('e2e seed fixture', () => {
  it('is pinned to the current DUMP_VERSION and passes the real import guard', () => {
    const guard = parseAndGuardDump(fixtureText)
    expect(guard.ok).toBe(true)
    if (!guard.ok) return
    expect(guard.dump.version).toBe(DUMP_VERSION)
  })

  it('restores cleanly through the real Zod boundary (row-level validity)', async () => {
    const guard = parseAndGuardDump(fixtureText)
    expect(guard.ok).toBe(true)
    if (!guard.ok) return
    await makeBackupService(db).restore(guard.dump)
    const recipes = await db.recipes.toArray()
    const readings = await db.readings.where('batchId').equals(FIXTURE_BATCH_ID).toArray()
    expect(recipes.map((r) => r.name)).toContain(FIXTURE_RECIPE_NAME)
    expect(readings.length).toBeGreaterThan(0)
  })
})
