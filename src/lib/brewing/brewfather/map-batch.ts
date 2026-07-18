/**
 * Pure mapper: Brewfather batch JSON → app `Batch` (+ its fermentation
 * `Reading` rows). No I/O, no clock — the caller injects `now`. The embedded
 * recipe becomes `Batch.recipeSnapshot` (charts/trends read it); measured
 * values map onto `BatchResults`; the batch's reading array becomes app
 * `Reading` rows keyed by the batch's stable id.
 */
import { apparentAttenuationPct } from '@/lib/brewing/batch/efficiency'
import type { Batch, BatchResults } from '@/lib/brewing/types/batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import type { Reading } from '@/lib/brewing/types/reading'
import { ReadingSchema } from '@/lib/brewing/types/reading'
import { brewfatherId } from './ids'
import { mapBrewfatherRecipe } from './map-recipe'
import { type BfBatch, BfBatchSchema, BfReadingSchema, bfTimestampToIso } from './schemas'

export interface MappedBatch {
  batch: Batch | null
  /** True when Brewfather carried no usable batch number — the orchestrator
   *  assigns the next local number at write time. */
  needsBatchNo: boolean
  readings: Reading[]
  warnings: string[]
}

/**
 * Brewfather → app status. Historical-import bias: an unknown/missing status
 * defaults to `complete` (with a warning) so a bulk migration can never flood
 * the active fermenter board with phantom in-progress batches.
 */
function mapStatus(raw: string | undefined, warn: (msg: string) => void): Batch['status'] {
  const lower = (raw ?? '').toLowerCase()
  if (lower === 'completed') return 'complete'
  if (lower === 'archived') return 'archived'
  if (
    lower === 'planning' ||
    lower === 'brewing' ||
    lower === 'fermenting' ||
    lower === 'conditioning'
  ) {
    return 'in-progress'
  }
  warn(
    raw
      ? `unknown status "${raw}" — defaulted to complete`
      : 'status missing — defaulted to complete',
  )
  return 'complete'
}

function buildResults(bf: BfBatch): BatchResults {
  const r: BatchResults = {}
  if (bf.measuredOg !== undefined) r.measuredOG = bf.measuredOg
  if (bf.measuredFg !== undefined) r.measuredFG = bf.measuredFg
  if (bf.measuredAbv !== undefined) r.measuredABV = bf.measuredAbv
  if (bf.measuredPreBoilGravity !== undefined) r.preBoilGravity = bf.measuredPreBoilGravity
  if (bf.measuredBoilSize !== undefined && bf.measuredBoilSize >= 0)
    r.preBoilVolume_L = bf.measuredBoilSize
  if (bf.measuredBatchSize !== undefined && bf.measuredBatchSize >= 0)
    r.intoFermenter_L = bf.measuredBatchSize
  if (bf.measuredEfficiency !== undefined && bf.measuredEfficiency >= 0)
    r.brewhouseEfficiency_pct = bf.measuredEfficiency
  // Derived from two imported values (same derivation the in-app brew flow uses).
  if (r.measuredOG !== undefined && r.measuredFG !== undefined)
    r.apparentAttenuation_pct = apparentAttenuationPct(r.measuredOG, r.measuredFG)
  return r
}

export function mapBrewfatherBatch(raw: unknown, opts: { now: string }): MappedBatch {
  const warnings: string[] = []
  const parsed = BfBatchSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      batch: null,
      needsBatchNo: false,
      readings: [],
      warnings: ['Skipped entity: not a recognizable Brewfather batch'],
    }
  }
  const bf = parsed.data

  const hasBatchNo = bf.batchNo !== undefined && Number.isInteger(bf.batchNo) && bf.batchNo >= 0
  const batchNo = hasBatchNo ? (bf.batchNo as number) : 0

  const label = `Batch${hasBatchNo ? ` #${batchNo}` : ''}${bf.name ? ` "${bf.name}"` : ''}`
  const warn = (msg: string) => warnings.push(`${label}: ${msg}`)

  // Stable id from _id; content-derived fallback (warned) keeps re-imports stable.
  const key =
    bf._id ?? `fallback:${bf.name ?? ''}:${batchNo}:${bfTimestampToIso(bf.brewDate) ?? ''}`
  if (!bf._id) warn('no Brewfather _id — id derived from name/number/date')
  const id = brewfatherId('batch', key)

  // Embedded recipe → snapshot. A batch without one still imports (warned).
  let recipeSnapshot: Batch['recipeSnapshot']
  let recipeId: string | undefined
  let recipeName: string | undefined
  if (bf.recipe !== undefined) {
    const mapped = mapBrewfatherRecipe(bf.recipe, opts)
    warnings.push(...mapped.warnings.map((w) => `${label}: ${w}`))
    if (mapped.recipe) {
      recipeSnapshot = mapped.recipe
      recipeId = mapped.recipe.id
      recipeName = mapped.recipe.name
    } else {
      warn('embedded recipe could not be mapped — imported without a recipe snapshot')
    }
  } else {
    warn('no embedded recipe — imported without a recipe snapshot')
  }

  const status = mapStatus(bf.status, warn)
  const brewedAt = bfTimestampToIso(bf.brewDate)
  const startedAt = brewedAt ?? bfTimestampToIso(bf.fermentationStartDate) ?? opts.now
  const bottledAt = bfTimestampToIso(bf.bottlingDate)

  // Brewfather names most batches literally "Batch" — prefer the recipe name.
  const rawName = bf.name?.trim()
  const name =
    rawName && rawName.toLowerCase() !== 'batch'
      ? rawName
      : (recipeName ?? (hasBatchNo ? `Batch ${batchNo}` : 'Imported batch'))

  const batch: Batch = {
    id,
    batchNo,
    name,
    status,
    process: [],
    logs: [],
    timers: [],
    results: buildResults(bf),
    startedAt,
    updatedAt: opts.now,
    schemaVersion: 1,
  }
  if (recipeId !== undefined) batch.recipeId = recipeId
  if (recipeSnapshot !== undefined) {
    batch.recipeSnapshot = recipeSnapshot
    batch.equipmentProfileId = recipeSnapshot.equipmentProfileId
  }
  if (brewedAt !== undefined) batch.brewedAt = brewedAt
  if (status === 'complete' && bottledAt !== undefined) batch.completedAt = bottledAt
  if (status === 'archived' && bottledAt !== undefined) batch.archivedAt = bottledAt
  if (bf.measuredMashPh !== undefined) batch.measuredMashPh = bf.measuredMashPh
  if (bf.batchNotes?.trim()) batch.outcomeNotes_md = bf.batchNotes

  const validBatch = BatchSchema.safeParse(batch)
  if (!validBatch.success) {
    warn(
      `skipped — mapped batch failed validation (${validBatch.error.issues[0]?.message ?? 'unknown'})`,
    )
    return { batch: null, needsBatchNo: false, readings: [], warnings }
  }

  // ── Readings ────────────────────────────────────────────────────────────────
  const readings: Reading[] = []
  const seen = new Set<string>()
  for (const [i, rawR] of (bf.readings ?? []).entries()) {
    const r = BfReadingSchema.safeParse(rawR)
    if (!r.success) {
      warn(`reading #${i + 1} skipped — unrecognizable entry`)
      continue
    }
    const at = bfTimestampToIso(r.data.time) ?? bfTimestampToIso(r.data.timestamp)
    if (at === undefined) {
      warn(`reading #${i + 1} skipped — no usable timestamp`)
      continue
    }
    const gravity = r.data.sg ?? r.data.gravity
    const note = r.data.comment ?? r.data.note
    if (gravity === undefined && r.data.temp === undefined && r.data.ph === undefined && !note) {
      warn(`reading #${i + 1} skipped — carries no measurements`)
      continue
    }
    // Content-addressed id: stable across re-exports even when the array grows.
    const readingKey = `${key}:${at}:${gravity ?? ''}:${r.data.temp ?? ''}`
    if (seen.has(readingKey)) continue // identical duplicate row in the file
    seen.add(readingKey)
    const reading: Reading = {
      id: brewfatherId('reading', readingKey),
      batchId: id,
      at,
      schemaVersion: 1,
    }
    if (gravity !== undefined) reading.gravity = gravity
    if (r.data.temp !== undefined) reading.tempC = r.data.temp
    if (r.data.ph !== undefined) reading.ph = r.data.ph
    if (note) reading.note = note
    const validReading = ReadingSchema.safeParse(reading)
    if (!validReading.success) {
      warn(`reading #${i + 1} skipped — failed validation`)
      continue
    }
    readings.push(validReading.data)
  }
  readings.sort((a, b) => a.at.localeCompare(b.at))

  return { batch: validBatch.data, needsBatchNo: !hasBatchNo, readings, warnings }
}
