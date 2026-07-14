import { describe, expect, it } from 'vitest'
import type { BrewSession } from '@/lib/brewing/process/session'
import { BrewSessionSchema } from '@/lib/brewing/types/session'

const valid: BrewSession = {
  id: '550e8400-e29b-41d4-a716-446655440200',
  recipeId: '550e8400-e29b-41d4-a716-446655440099',
  recipeName: 'West Coast IPA',
  manualVersion: 1,
  lifecycle: 'running',
  stageId: 'hotside',
  cursor: 'ramp-to-boil',
  resolvedSteps: ['p1', 'ramp-to-boil'],
  steps: {
    p1: {
      id: 'p1',
      status: 'done',
      logs: [{ field: 'src', value: 'RO', at: '2026-06-25T10:00:00.000Z' }],
      completedAt: '2026-06-25T10:00:00.000Z',
    },
    'ramp-to-boil': { id: 'ramp-to-boil', status: 'active', logs: [] },
  },
  choices: { carbPath: 'co2', noSparge: false },
  water: { sourceProfileName: 'RO', additionsSummary: '2g gypsum', skipped: false, estMashPh: 5.4 },
  timers: [
    {
      id: 't1',
      stepId: 'ramp-to-boil',
      label: 'Boil 60',
      fireAt: '2026-06-25T11:00:00.000Z',
      status: 'armed',
    },
  ],
  startedAt: '2026-06-25T10:00:00.000Z',
  updatedAt: '2026-06-25T10:10:00.000Z',
  schemaVersion: 1,
}

describe('BrewSessionSchema', () => {
  it('parses a fully-populated session round-trip equal', () => {
    expect(BrewSessionSchema.parse(valid)).toEqual(valid)
  })

  it('parses a minimal session (optional fields omitted)', () => {
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440201',
      manualVersion: 1,
      lifecycle: 'idle',
      stageId: 'prep',
      cursor: 'p1',
      resolvedSteps: ['p1'],
      steps: { p1: { id: 'p1', status: 'active', logs: [] } },
      choices: {},
      timers: [],
      startedAt: '2026-06-25T10:00:00.000Z',
      updatedAt: '2026-06-25T10:00:00.000Z',
      schemaVersion: 1,
    }
    expect(() => BrewSessionSchema.parse(minimal)).not.toThrow()
  })

  it('rejects an unknown lifecycle value via .issues', () => {
    const bad = { ...valid, lifecycle: 'wat' }
    const res = BrewSessionSchema.safeParse(bad)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues.length).toBeGreaterThan(0)
  })

  it('rejects schemaVersion != 1', () => {
    expect(BrewSessionSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false)
  })

  it('preserves an optional fermenterId round-trip (not stripped by Zod)', () => {
    const withFermenter = { ...valid, fermenterId: 'f3' }
    const parsed = BrewSessionSchema.parse(withFermenter)
    expect(parsed.fermenterId).toBe('f3')
  })

  it('parses a legacy session with no fermenterId (field absent stays valid)', () => {
    // `valid` has no fermenterId; parsing must not add or require it.
    const parsed = BrewSessionSchema.parse(valid)
    expect(parsed.fermenterId).toBeUndefined()
  })
})
