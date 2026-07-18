import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapBrewfatherBatch } from '@/lib/brewing/brewfather/map-batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import { ReadingSchema } from '@/lib/brewing/types/reading'

const NOW = '2026-07-17T10:00:00.000Z'

function loadFixture(name: string): unknown[] {
  const file = path.join(__dirname, '../../fixtures/brewfather', name)
  return JSON.parse(readFileSync(file, 'utf-8'))
}

const completed = () => loadFixture('batches.json')[0]
const fermenting = () => loadFixture('batches.json')[1]

describe('mapBrewfatherBatch', () => {
  it('maps the completed fixture batch to a schema-valid app Batch', () => {
    const { batch, needsBatchNo } = mapBrewfatherBatch(completed(), { now: NOW })
    expect(batch).not.toBeNull()
    const b = BatchSchema.parse(batch)

    expect(b.batchNo).toBe(42)
    expect(needsBatchNo).toBe(false)
    expect(b.status).toBe('complete')
    // Brewfather's generic "Batch" name is replaced by the recipe name.
    expect(b.name).toBe('Hazy Horizon IPA')
    expect(b.brewedAt).toBe(new Date(1746092400000).toISOString())
    expect(b.startedAt).toBe(b.brewedAt)
    expect(b.completedAt).toBe(new Date(1747302000000).toISOString())
    expect(b.measuredMashPh).toBe(5.35)
    expect(b.outcomeNotes_md).toContain('boil-over')
  })

  it('maps measured values onto BatchResults', () => {
    const { batch } = mapBrewfatherBatch(completed(), { now: NOW })
    expect(batch?.results.measuredOG).toBe(1.061)
    expect(batch?.results.measuredFG).toBe(1.013)
    expect(batch?.results.measuredABV).toBe(6.3)
    expect(batch?.results.preBoilGravity).toBe(1.051)
    expect(batch?.results.preBoilVolume_L).toBe(23.5)
    expect(batch?.results.intoFermenter_L).toBe(19.2)
    expect(batch?.results.brewhouseEfficiency_pct).toBe(68.5)
    // Derived from the two imported gravities.
    expect(batch?.results.apparentAttenuation_pct).toBeCloseTo(78.7, 1)
  })

  it('builds recipeSnapshot from the embedded recipe (charts/trends read it)', () => {
    const { batch } = mapBrewfatherBatch(completed(), { now: NOW })
    expect(batch?.recipeSnapshot?.name).toBe('Hazy Horizon IPA')
    expect(batch?.recipeSnapshot?.batchSize_L).toBe(20)
    expect(batch?.recipeSnapshot?.fermentables).toHaveLength(1)
    // recipeId links to the same uuid a recipes.json import derives for that _id.
    expect(batch?.recipeId).toBe(batch?.recipeSnapshot?.id)
  })

  it('maps the reading array to app Reading rows keyed by the batch id', () => {
    const { batch, readings, warnings } = mapBrewfatherBatch(completed(), { now: NOW })
    // 4 raw readings; the one with no timestamp is skipped with a warning.
    expect(readings).toHaveLength(3)
    expect(warnings.join('\n')).toMatch(/no usable timestamp/)
    for (const r of readings) {
      ReadingSchema.parse(r)
      expect(r.batchId).toBe(batch?.id)
    }
    // Sorted chronologically; values carried through.
    expect(readings[0].gravity).toBe(1.061)
    expect(readings[1].note).toBe('Krausen peak')
    expect(readings[2].ph).toBe(4.4)
    expect(readings[2].tempC).toBe(19.5)
  })

  it('maps Fermenting → in-progress', () => {
    const { batch } = mapBrewfatherBatch(fermenting(), { now: NOW })
    expect(batch?.status).toBe('in-progress')
    expect(batch?.completedAt).toBeUndefined()
  })

  it('defaults a missing status to complete with a warning (never floods the board)', () => {
    const { batch, warnings } = mapBrewfatherBatch(
      { _id: 'x', batchNo: 7, recipe: { _id: 'r', name: 'R', batchSize: 20, boilTime: 60 } },
      { now: NOW },
    )
    expect(batch?.status).toBe('complete')
    expect(warnings.join('\n')).toMatch(/status missing/)
  })

  it('imports a batch without an embedded recipe, warning instead of failing', () => {
    const { batch, warnings } = mapBrewfatherBatch(
      { _id: 'x', batchNo: 3, status: 'Archived', brewDate: 1746092400000 },
      { now: NOW },
    )
    expect(batch).not.toBeNull()
    expect(batch?.recipeSnapshot).toBeUndefined()
    expect(batch?.status).toBe('archived')
    expect(warnings.join('\n')).toMatch(/no embedded recipe/)
  })

  it('flags a missing batch number for orchestrator assignment', () => {
    const { batch, needsBatchNo } = mapBrewfatherBatch(
      { _id: 'x', status: 'Completed', recipe: { name: 'R', batchSize: 20, boilTime: 60 } },
      { now: NOW },
    )
    expect(batch).not.toBeNull()
    expect(needsBatchNo).toBe(true)
  })

  it('derives stable ids: same input, same batch + reading uuids', () => {
    const a = mapBrewfatherBatch(completed(), { now: NOW })
    const b = mapBrewfatherBatch(completed(), { now: '2027-01-01T00:00:00.000Z' })
    expect(a.batch?.id).toBe(b.batch?.id)
    expect(a.readings.map((r) => r.id)).toEqual(b.readings.map((r) => r.id))
  })

  it('skips a non-object entity with a warning', () => {
    const { batch, warnings } = mapBrewfatherBatch(42, { now: NOW })
    expect(batch).toBeNull()
    expect(warnings).toHaveLength(1)
  })
})
