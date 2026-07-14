/**
 * Unit tests for sessionToBatch — pure mapper, no I/O.
 */
import { describe, expect, it } from 'vitest'
import { sessionToBatch } from '@/lib/brewing/batch/from-session'
import { BREW_MANUAL } from '@/lib/brewing/process/manual'
import type { BrewSession, StepState } from '@/lib/brewing/process/session'
import type { ProcessManual } from '@/lib/brewing/process/types'
import type { Batch } from '@/lib/brewing/types/batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'

// ── Minimal fixtures ─────────────────────────────────────────────────────────

const NOW = '2026-06-25T12:00:00.000Z'
const NOW2 = '2026-06-25T14:00:00.000Z'
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BATCH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const RECIPE: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'Test Pale Ale',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
}

const EQUIPMENT: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40pro',
  isDefault: true,
  mashTunVolume_L: 38,
  mashTunDeadSpace_L: 2,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 0.5,
  fermenterVolume_L: 23,
  fermenterDeadSpace_L: 0.5,
  evaporationRate_LperHr: 3.5,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1,
  mashEfficiency_pct: 75,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1,
  calibrationNotes_md: '',
  schemaVersion: 1,
}

const CALC: CalculationResult = {
  volumes: {
    mashWater_L: 12,
    spargeWater_L: 10,
    preBoilVolume_L: 22,
    postBoilVolume_L: 18.5,
    intoFermenter_L: 17.8,
  },
  OG: 1.048,
  FG: 1.012,
  ABV: 4.73,
  IBU: 35,
  SRM: 5,
  strikeTemp_C: 70,
  formulasUsed: { ibu: 'tinseth', srm: 'morey', abv: 'simple' },
  computedAt: NOW,
  schemaVersion: 1,
}

// Minimal manual with 2 steps across 2 stages.
// Log keys match the REAL brew manual keys so results derivation works.
const MANUAL: ProcessManual = {
  version: 1,
  stages: [
    {
      id: 'prep',
      title: 'Prep',
      steps: [
        {
          id: 'step-a',
          title: 'Step A',
          body_md: '',
          values: [],
          logs: [
            // Real key from manual.stages/01-hotside measure-og-efficiency step
            {
              key: 'og-measured',
              label: 'OG measured',
              kind: 'gravity',
              unit: 'SG',
              targetValueKey: 'targetOG',
            },
          ],
          timers: [],
        },
      ],
    },
    {
      id: 'hotside',
      title: 'Hot Side',
      steps: [
        {
          id: 'step-b',
          title: 'Step B',
          body_md: '',
          values: [],
          logs: [{ key: 'temp-log', label: 'Temperature', kind: 'temp', unit: '°C' }],
          timers: [],
        },
      ],
    },
  ],
}

function makeSession(
  lifecycle: BrewSession['lifecycle'],
  stepLogs: { stepId: string; field: string; value: string | number | boolean; at: string }[] = [],
): BrewSession {
  const stepStates: Record<string, StepState> = {
    'step-a': { id: 'step-a', status: 'active', logs: [] },
    'step-b': { id: 'step-b', status: 'pending', logs: [] },
  }

  for (const entry of stepLogs) {
    if (!stepStates[entry.stepId]) {
      stepStates[entry.stepId] = { id: entry.stepId, status: 'done', logs: [] }
    }
    stepStates[entry.stepId] = {
      ...stepStates[entry.stepId],
      logs: [
        ...stepStates[entry.stepId].logs,
        { field: entry.field, value: entry.value, at: entry.at },
      ],
    }
  }

  return {
    id: SESSION_ID,
    recipeId: RECIPE.id,
    recipeName: RECIPE.name,
    manualVersion: 1,
    lifecycle,
    stageId: 'prep',
    cursor: 'step-a',
    resolvedSteps: ['step-a', 'step-b'],
    steps: stepStates,
    choices: {},
    timers: [],
    startedAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sessionToBatch', () => {
  // Test 1: running session → in-progress, logs flattened, batchNo/id set
  it('running session → status in-progress; logs present → flattened into LogEntry[]; batchNo/id set', () => {
    const session = makeSession('running', [
      { stepId: 'step-a', field: 'og-measured', value: 1.048, at: NOW },
    ])

    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 3,
      now: NOW,
    })

    expect(batch.status).toBe('in-progress')
    expect(batch.id).toBe(BATCH_ID)
    expect(batch.batchNo).toBe(3)
    expect(batch.startedAt).toBe(NOW)
    expect(batch.updatedAt).toBe(NOW)
    expect(batch.schemaVersion).toBe(1)

    // Logs should be flattened from all steps
    expect(batch.logs).toHaveLength(1)
    expect(batch.logs[0].key).toBe('og-measured')
    expect(batch.logs[0].label).toBe('OG measured')
    expect(batch.logs[0].stepId).toBe('step-a')
    expect(batch.logs[0].value).toBe(1.048)
    expect(batch.logs[0].unit).toBe('SG')

    // Results should be derived from real key
    expect(batch.results.measuredOG).toBe(1.048)

    // Timers should be empty
    expect(batch.timers).toHaveLength(0)
  })

  // aborted → archived (+ archivedAt) — the re-attach-bug fix
  it('aborted session → status archived; archivedAt set to now', () => {
    const batch = sessionToBatch({
      session: makeSession('aborted'),
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })
    expect(batch.status).toBe('archived')
    expect(batch.archivedAt).toBe(NOW)
    // Never left in-progress (that was the re-attach bug) and never completed.
    expect(batch.completedAt).toBeUndefined()
    expect(() => BatchSchema.parse(batch)).not.toThrow()
  })

  it('re-map to aborted preserves the first archivedAt (does not bump it)', () => {
    const existing = sessionToBatch({
      session: makeSession('aborted'),
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })
    expect(existing.archivedAt).toBe(NOW)

    const reMapped = sessionToBatch({
      session: makeSession('aborted'),
      manual: MANUAL,
      id: 'ignored-id',
      batchNo: 99,
      now: NOW2,
      existing,
    })
    expect(reMapped.status).toBe('archived')
    expect(reMapped.archivedAt).toBe(NOW) // preserved, not NOW2
  })

  it('running/paused → in-progress with no archivedAt (unchanged)', () => {
    for (const lc of ['running', 'paused'] as const) {
      const batch = sessionToBatch({
        session: makeSession(lc),
        recipe: RECIPE,
        equipment: EQUIPMENT,
        calc: CALC,
        manual: MANUAL,
        id: BATCH_ID,
        batchNo: 1,
        now: NOW,
      })
      expect(batch.status).toBe('in-progress')
      expect(batch.archivedAt).toBeUndefined()
    }
  })

  // Test 2: done session → complete; completedAt set to now
  it('done session → status complete; completedAt set to now', () => {
    const session = makeSession('done')
    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW2,
    })

    expect(batch.status).toBe('complete')
    expect(batch.completedAt).toBe(NOW2)
  })

  // Test 3: re-map with existing → preserves id, batchNo, startedAt; updatedAt updated
  it('re-map with existing → preserves id, batchNo, startedAt; updatedAt updated', () => {
    const ORIGINAL_STARTED = '2026-06-25T08:00:00.000Z'
    const ORIGINAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

    const existing: Batch = sessionToBatch({
      session: makeSession('running'),
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: ORIGINAL_ID,
      batchNo: 5,
      now: ORIGINAL_STARTED,
    })

    // Re-map with paused session and new now
    const updated = sessionToBatch({
      session: makeSession('paused', [
        { stepId: 'step-a', field: 'og-measured', value: 1.05, at: NOW },
      ]),
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID, // injected id should be ignored — existing.id wins
      batchNo: 99, // injected batchNo should be ignored — existing.batchNo wins
      now: NOW2,
      existing,
    })

    expect(updated.id).toBe(ORIGINAL_ID)
    expect(updated.batchNo).toBe(5)
    expect(updated.startedAt).toBe(ORIGINAL_STARTED)
    expect(updated.updatedAt).toBe(NOW2)
    expect(updated.status).toBe('in-progress')
  })

  // Test 4: log with targetValueKey → target field populated on LogEntry
  it('log with targetValueKey → target field populated on LogEntry from calc', () => {
    const session = makeSession('running', [
      { stepId: 'step-a', field: 'og-measured', value: 1.048, at: NOW },
    ])

    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })

    // The step-a 'og-measured' field has targetValueKey: 'targetOG' which resolves to CALC.OG = 1.048
    const ogEntry = batch.logs.find((l) => l.key === 'og-measured')
    expect(ogEntry).toBeDefined()
    expect(ogEntry?.target).toBeDefined()
    expect(ogEntry?.target).toBe(CALC.OG)
  })

  // Test 5: session starts running → sessionToBatch produces in-progress batch
  it('integration: session starts running → produces in-progress batch', () => {
    const session = makeSession('running')
    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })

    expect(batch.status).toBe('in-progress')
    expect(batch.name).toBe(RECIPE.name)
    expect(batch.recipeId).toBe(RECIPE.id)
    expect(batch.equipmentProfileId).toBe(RECIPE.equipmentProfileId)
    expect(batch.recipeSnapshot).toMatchObject({ id: RECIPE.id, name: RECIPE.name })
    expect(batch.computedTargets?.OG).toBe(CALC.OG)
    expect(batch.completedAt).toBeUndefined()
  })

  // Test 6: session becomes done → re-map → status complete, completedAt defined
  it('integration: session becomes done → re-map → status complete, completedAt defined', () => {
    const session = makeSession('running')
    const inProgressBatch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })

    expect(inProgressBatch.status).toBe('in-progress')
    expect(inProgressBatch.completedAt).toBeUndefined()

    // Now session finishes
    const doneSession = makeSession('done', [
      { stepId: 'step-a', field: 'og-measured', value: 1.05, at: NOW },
      { stepId: 'step-b', field: 'temp-log', value: 19, at: NOW },
    ])

    const completedBatch = sessionToBatch({
      session: doneSession,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW2,
      existing: inProgressBatch,
    })

    expect(completedBatch.status).toBe('complete')
    expect(completedBatch.completedAt).toBe(NOW2)
    expect(completedBatch.id).toBe(BATCH_ID)
    expect(completedBatch.logs).toHaveLength(2)
  })

  // ── fermenterBoardId (fermenter↔batch link) ──────────────────────────────────

  // A supplied fermenterId is recorded as batch.fermenterBoardId, and the batch
  // still parses against BatchSchema (the field is z.string().optional()).
  it('emits fermenterBoardId from the fermenterId arg (still valid Zod)', () => {
    const session = makeSession('running')
    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
      fermenterId: 'f1',
    })
    expect(batch.fermenterBoardId).toBe('f1')
    expect(() => BatchSchema.parse(batch)).not.toThrow()
  })

  // No fermenterId (manual brew) → field omitted, still schema-valid.
  it('omits fermenterBoardId when no fermenterId is supplied', () => {
    const session = makeSession('running')
    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })
    expect(batch.fermenterBoardId).toBeUndefined()
    expect(() => BatchSchema.parse(batch)).not.toThrow()
  })

  // Re-map without a fermenterId must preserve the previously-stamped link.
  it('re-map without fermenterId preserves existing fermenterBoardId', () => {
    const existing = sessionToBatch({
      session: makeSession('running'),
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
      fermenterId: 'f3',
    })
    expect(existing.fermenterBoardId).toBe('f3')

    const reMapped = sessionToBatch({
      session: makeSession('paused'),
      manual: MANUAL,
      id: 'ignored-id',
      batchNo: 99,
      now: NOW2,
      existing,
      // fermenterId intentionally omitted (hydrate race / re-map path)
    })
    expect(reMapped.fermenterBoardId).toBe('f3')
  })

  // ── Snapshot-optional tests (manual brew / race condition) ───────────────────

  // Test 7: no recipe/equipment/calc → schema-valid batch with snapshots undefined
  it('manual brew (no recipe/equipment/calc) → BatchSchema.parse succeeds, snapshots undefined', () => {
    const manualSession: BrewSession = {
      id: SESSION_ID,
      // no recipeId
      recipeName: 'My Manual Brew',
      manualVersion: 1,
      lifecycle: 'running',
      stageId: 'prep',
      cursor: 'step-a',
      resolvedSteps: ['step-a'],
      steps: { 'step-a': { id: 'step-a', status: 'active', logs: [] } },
      choices: {},
      timers: [],
      startedAt: NOW,
      updatedAt: NOW,
      schemaVersion: 1,
    }
    const batch = sessionToBatch({
      session: manualSession,
      // recipe, equipment, calc all omitted
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })
    // Must parse without throwing
    expect(() => BatchSchema.parse(batch)).not.toThrow()
    expect(batch.recipeSnapshot).toBeUndefined()
    expect(batch.equipmentSnapshot).toBeUndefined()
    expect(batch.computedTargets).toBeUndefined()
    expect(batch.status).toBe('in-progress')
  })

  // Test 8: with recipe/equipment/calc present → snapshots are captured
  it('with recipe/equipment/calc present → snapshots captured in batch', () => {
    const session = makeSession('running')
    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })
    expect(batch.recipeSnapshot).toBeDefined()
    expect(batch.recipeSnapshot?.id).toBe(RECIPE.id)
    expect(batch.equipmentSnapshot).toBeDefined()
    expect(batch.equipmentSnapshot?.id).toBe(EQUIPMENT.id)
    expect(batch.computedTargets).toBeDefined()
    expect(batch.computedTargets?.OG).toBe(CALC.OG)
    // Must still be schema-valid
    expect(() => BatchSchema.parse(batch)).not.toThrow()
  })

  // Test 9: re-map preserves existing snapshot when new input is undefined (race condition)
  it('re-map without recipe/equipment/calc preserves existing snapshots (hydrate race)', () => {
    // First create with all snapshots present
    const session = makeSession('running')
    const existing = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: MANUAL,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW,
    })
    expect(existing.recipeSnapshot).toBeDefined()

    // Re-map without recipe/equipment/calc (simulates race before stores hydrate)
    const reMapped = sessionToBatch({
      session: makeSession('paused'),
      // no recipe/equipment/calc passed
      manual: MANUAL,
      id: 'ignored-id',
      batchNo: 99,
      now: NOW2,
      existing,
    })
    // Existing snapshots must be preserved
    expect(reMapped.recipeSnapshot).toBeDefined()
    expect(reMapped.recipeSnapshot?.id).toBe(RECIPE.id)
    expect(reMapped.equipmentSnapshot).toBeDefined()
    expect(reMapped.computedTargets).toBeDefined()
    expect(reMapped.computedTargets?.OG).toBe(CALC.OG)
    // Identity preserved
    expect(reMapped.id).toBe(BATCH_ID)
    expect(reMapped.batchNo).toBe(1)
    expect(() => BatchSchema.parse(reMapped)).not.toThrow()
  })

  // Additional: results derivation (OG+FG → ABV) — uses real manual log keys
  it('derives measuredABV from measuredOG and measuredFG using real log keys', () => {
    const session = makeSession('done', [
      { stepId: 'step-a', field: 'og-measured', value: 1.048, at: NOW },
      { stepId: 'step-b', field: 'fg-final', value: 1.012, at: NOW },
    ])

    // Add fg-final (real key) to the manual step-b logs
    const manualWithFG: ProcessManual = {
      ...MANUAL,
      stages: MANUAL.stages.map((stage) => ({
        ...stage,
        steps: stage.steps.map((step) =>
          step.id === 'step-b'
            ? {
                ...step,
                logs: [{ key: 'fg-final', label: 'FG (measured)', kind: 'gravity' as const }],
              }
            : step,
        ),
      })),
    }

    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: manualWithFG,
      id: BATCH_ID,
      batchNo: 1,
      now: NOW2,
    })

    expect(batch.results.measuredOG).toBe(1.048)
    expect(batch.results.measuredFG).toBe(1.012)
    expect(batch.results.measuredABV).toBeCloseTo((1.048 - 1.012) * 131.25, 5)
  })
})

// ── BREW_MANUAL real-keys integration test (C3 + I3 verification) ─────────────
describe('sessionToBatch with REAL BREW_MANUAL keys', () => {
  /**
   * Builds a minimal BrewSession that logs to the REAL step IDs from BREW_MANUAL.
   * Logs og-measured + into-fermenter-volume (step measure-og-efficiency in hotside)
   * and fg-final (step label-close-batch in packaging).
   * Asserts that results.measuredOG, measuredFG, measuredABV, and
   * brewhouseEfficiency_pct are all populated (not undefined).
   */
  it('logs to real step ids → measuredOG/measuredFG/measuredABV/brewhouseEfficiency_pct are populated', () => {
    // Build a StepState map covering the real step ids we need to log against
    const stepStates: Record<string, StepState> = {
      'measure-og-efficiency': {
        id: 'measure-og-efficiency',
        status: 'done',
        logs: [
          { field: 'og-measured', value: 1.052, at: NOW },
          { field: 'into-fermenter-volume', value: 18.5, at: NOW },
        ],
      },
      'label-close-batch': {
        id: 'label-close-batch',
        status: 'done',
        logs: [{ field: 'fg-final', value: 1.012, at: NOW }],
      },
    }

    const realSession: BrewSession = {
      id: SESSION_ID,
      recipeId: RECIPE.id,
      recipeName: RECIPE.name,
      manualVersion: 1,
      lifecycle: 'done',
      stageId: 'packaging',
      cursor: 'label-close-batch',
      // resolvedSteps only needs to include the steps we have states for
      resolvedSteps: ['measure-og-efficiency', 'label-close-batch'],
      steps: stepStates,
      choices: {},
      timers: [],
      startedAt: NOW,
      updatedAt: NOW,
      schemaVersion: 1,
    }

    const batch = sessionToBatch({
      session: realSession,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: BREW_MANUAL,
      id: BATCH_ID,
      batchNo: 7,
      now: NOW,
    })

    // C3: real OG key resolved
    expect(batch.results.measuredOG).toBe(1.052)
    // C3: real FG key resolved
    expect(batch.results.measuredFG).toBe(1.012)
    // C3: into-fermenter-volume key resolved
    expect(batch.results.intoFermenter_L).toBe(18.5)
    // C3: ABV computed
    expect(batch.results.measuredABV).toBeCloseTo((1.052 - 1.012) * 131.25, 5)
    // I3: brewhouseEfficiency_pct computed (not undefined)
    expect(batch.results.brewhouseEfficiency_pct).toBeDefined()
    expect(batch.results.brewhouseEfficiency_pct).toBeGreaterThan(0)
    expect(batch.results.brewhouseEfficiency_pct).toBeLessThanOrEqual(100)
    // I3: apparentAttenuation_pct computed
    expect(batch.results.apparentAttenuation_pct).toBeDefined()
    expect(batch.results.apparentAttenuation_pct).toBeGreaterThan(0)
  })

  it('OG priority: og-final beats og-measured beats og-at-pitch', () => {
    const stepStates: Record<string, StepState> = {
      'pitch-yeast': {
        id: 'pitch-yeast',
        status: 'done',
        logs: [{ field: 'og-at-pitch', value: 1.05, at: NOW }],
      },
      'measure-og-efficiency': {
        id: 'measure-og-efficiency',
        status: 'done',
        logs: [
          { field: 'og-measured', value: 1.051, at: NOW },
          { field: 'into-fermenter-volume', value: 19, at: NOW },
        ],
      },
      'label-close-batch': {
        id: 'label-close-batch',
        status: 'done',
        logs: [
          { field: 'og-final', value: 1.052, at: NOW },
          { field: 'fg-final', value: 1.012, at: NOW },
        ],
      },
    }

    const realSession: BrewSession = {
      id: SESSION_ID,
      recipeId: RECIPE.id,
      recipeName: RECIPE.name,
      manualVersion: 1,
      lifecycle: 'done',
      stageId: 'packaging',
      cursor: 'label-close-batch',
      resolvedSteps: ['pitch-yeast', 'measure-og-efficiency', 'label-close-batch'],
      steps: stepStates,
      choices: {},
      timers: [],
      startedAt: NOW,
      updatedAt: NOW,
      schemaVersion: 1,
    }

    const batch = sessionToBatch({
      session: realSession,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: BREW_MANUAL,
      id: BATCH_ID,
      batchNo: 8,
      now: NOW,
    })

    // og-final (1.052) should win over og-measured (1.051) and og-at-pitch (1.050)
    expect(batch.results.measuredOG).toBe(1.052)
    // fg-final should be populated
    expect(batch.results.measuredFG).toBe(1.012)
  })
})

// M1 regression: FG > OG (e.g. typo'd entry) must yield measuredABV = 0, not negative.
describe('M1 regression — measuredABV is 0 when FG >= OG', () => {
  it('FG > OG → measuredABV is 0 (not negative)', () => {
    const manualWithFG: ProcessManual = {
      ...MANUAL,
      stages: MANUAL.stages.map((stage) => ({
        ...stage,
        steps: stage.steps.map((step) =>
          step.id === 'step-b'
            ? {
                ...step,
                logs: [{ key: 'fg-final', label: 'FG (measured)', kind: 'gravity' as const }],
              }
            : step,
        ),
      })),
    }

    // FG (1.052) deliberately greater than OG (1.048) — simulate a data-entry typo
    const session = makeSession('done', [
      { stepId: 'step-a', field: 'og-measured', value: 1.048, at: NOW },
      { stepId: 'step-b', field: 'fg-final', value: 1.052, at: NOW },
    ])

    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: manualWithFG,
      id: BATCH_ID,
      batchNo: 99,
      now: NOW,
    })

    expect(batch.results.measuredOG).toBe(1.048)
    expect(batch.results.measuredFG).toBe(1.052)
    // Must be 0, never negative
    expect(batch.results.measuredABV).toBe(0)
  })

  it('FG === OG → measuredABV is 0', () => {
    const manualWithFG: ProcessManual = {
      ...MANUAL,
      stages: MANUAL.stages.map((stage) => ({
        ...stage,
        steps: stage.steps.map((step) =>
          step.id === 'step-b'
            ? {
                ...step,
                logs: [{ key: 'fg-final', label: 'FG (measured)', kind: 'gravity' as const }],
              }
            : step,
        ),
      })),
    }

    const session = makeSession('done', [
      { stepId: 'step-a', field: 'og-measured', value: 1.048, at: NOW },
      { stepId: 'step-b', field: 'fg-final', value: 1.048, at: NOW },
    ])

    const batch = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT,
      calc: CALC,
      manual: manualWithFG,
      id: BATCH_ID,
      batchNo: 100,
      now: NOW,
    })

    expect(batch.results.measuredABV).toBe(0)
  })

  // ── I1: measured ABV uses equipment profile abvFormula ─────────────────────
  // Proves the fix: equipment.abvFormula='advanced' produces a different (and
  // correct) measuredABV than 'simple', so the hardcoded 'simple' is gone.
  it('(I1) measuredABV uses equipment abvFormula="advanced" when both OG and FG are known', () => {
    const manualWithOGandFG: ProcessManual = {
      ...MANUAL,
      stages: MANUAL.stages.map((stage) => ({
        ...stage,
        steps: stage.steps.map((step) =>
          step.id === 'step-b'
            ? {
                ...step,
                logs: [{ key: 'fg-final', label: 'FG (measured)', kind: 'gravity' as const }],
              }
            : step,
        ),
      })),
    }

    const advancedEquipment = { ...EQUIPMENT, abvFormula: 'advanced' as const }

    const session = makeSession('done', [
      { stepId: 'step-a', field: 'og-measured', value: 1.048, at: NOW },
      { stepId: 'step-b', field: 'fg-final', value: 1.01, at: NOW },
    ])

    const batchAdvanced = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: advancedEquipment,
      calc: CALC,
      manual: manualWithOGandFG,
      id: BATCH_ID,
      batchNo: 101,
      now: NOW,
    })

    const batchSimple = sessionToBatch({
      session,
      recipe: RECIPE,
      equipment: EQUIPMENT, // abvFormula: 'simple'
      calc: CALC,
      manual: manualWithOGandFG,
      id: BATCH_ID,
      batchNo: 102,
      now: NOW,
    })

    // Advanced formula: ((76.08 × (OG−FG)) / (1.775−OG)) × (FG / 0.794)
    const expectedAdvanced = ((76.08 * (1.048 - 1.01)) / (1.775 - 1.048)) * (1.01 / 0.794)
    // Simple formula: (OG−FG) × 131.25
    const expectedSimple = (1.048 - 1.01) * 131.25

    expect(batchAdvanced.results.measuredABV).toBeCloseTo(expectedAdvanced, 4)
    expect(batchSimple.results.measuredABV).toBeCloseTo(expectedSimple, 4)
    // The two formulas must produce different values (otherwise the fix is invisible)
    expect(batchAdvanced.results.measuredABV).not.toBeCloseTo(expectedSimple, 2)
  })
})
