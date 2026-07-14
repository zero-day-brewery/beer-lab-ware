import { describe, expect, it } from 'vitest'
import { resolveBranches } from '@/lib/brewing/process/branches'
import { BREW_MANUAL, MANUAL_VERSION } from '@/lib/brewing/process/manual'
import type { ProcessChoices } from '@/lib/brewing/process/types'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Volumes } from '@/lib/brewing/types/results'

const allSteps = () => BREW_MANUAL.stages.flatMap((s) => s.steps)

const minimalRecipe: Recipe = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Snap',
  type: 'all-grain',
  batchSize_L: 23,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [{ name: 'Sacch', type: 'temperature', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 1,
} as Recipe

const vols: Volumes = {
  mashWater_L: 13,
  spargeWater_L: 20,
  preBoilVolume_L: 27.6,
  postBoilVolume_L: 26,
  intoFermenter_L: 23,
}

describe('BREW_MANUAL structure', () => {
  it('has 5 stages in order with version pinned', () => {
    expect(MANUAL_VERSION).toBe(1)
    expect(BREW_MANUAL.version).toBe(1)
    expect(BREW_MANUAL.stages.map((s) => s.id)).toEqual([
      'prep',
      'hotside',
      'fermentation',
      'packaging',
      'conditioning',
    ])
  })

  it('locks per-stage step counts', () => {
    const counts = Object.fromEntries(BREW_MANUAL.stages.map((s) => [s.id, s.steps.length]))
    expect(counts).toEqual({
      prep: 15,
      hotside: 14,
      fermentation: 14,
      packaging: 14,
      conditioning: 18,
    })
  })

  it('every StepId is unique and kebab-case', () => {
    const ids = allSteps().map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('exposes the canonical resume + boil-master anchors', () => {
    const ids = new Set(allSteps().map((s) => s.id))
    expect(ids.has('pitch-yeast')).toBe(true)
    expect(ids.has('ramp-to-boil')).toBe(true)
    expect(ids.has('archive-batch')).toBe(true)
    const boilMasters = allSteps()
      .flatMap((s) => s.timers)
      .filter((t) => t.isBoilMaster)
    expect(boilMasters).toHaveLength(1)
    expect(boilMasters[0]?.id).toBe('boil-master')
    expect(boilMasters[0]?.durationFrom).toEqual({ kind: 'recipe', path: 'boilTime_min' })
  })

  it('exactly one startSession effect and one endSession effect across the tree', () => {
    const enter = allSteps().flatMap((s) => s.enterEffects ?? [])
    const complete = allSteps().flatMap((s) => s.completeEffects ?? [])
    const all = [...enter, ...complete]
    expect(all.filter((e) => e.t === 'startSession')).toHaveLength(1)
    expect(all.filter((e) => e.t === 'endSession')).toHaveLength(1)
  })

  it('branch steps drop out of a single-infusion, no-misc, co2 recipe', () => {
    const choices: ProcessChoices = { carbPath: 'co2', pressureFromPitch: true }
    const active = resolveBranches(BREW_MANUAL, minimalRecipe, choices, vols)
    // step-mash + mash-out + whirlpool + dry-hop + miscs branches all excluded
    expect(active.has('ramp-next-step')).toBe(false)
    expect(active.has('mash-out')).toBe(false)
    expect(active.has('whirlpool-hopstand')).toBe(false)
    expect(active.has('closed-dry-hop')).toBe(false)
    expect(active.has('weigh-adjuncts')).toBe(false)
    // oxygenate dropped because pressureFromPitch true (not pressureFromPitch = false)
    expect(active.has('oxygenate-wort')).toBe(false)
    // sparge kept (sparge water > 0); co2 steps kept; nitro steps dropped
    expect(active.has('sparge-bed')).toBe(true)
    expect(active.has('co2-set-regulator')).toBe(true)
    expect(active.has('nitro-dispense-beergas')).toBe(false)
    expect(active.has('nitro-dispense-pressure')).toBe(false)
  })

  it('branch steps appear for a step-mash, dry-hopped, nitro, with-miscs recipe', () => {
    const r: Recipe = {
      ...minimalRecipe,
      mashSteps: [
        { name: 'Beta', type: 'temperature', temperature_C: 63, time_min: 30 },
        { name: 'Mash Out', type: 'temperature', temperature_C: 76, time_min: 10 },
      ],
      hops: [
        {
          ingredientId: '00000000-0000-0000-0000-0000000000aa',
          snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' },
          amount_g: 28,
          time_min: 0,
          use: 'whirlpool',
        },
        {
          ingredientId: '00000000-0000-0000-0000-0000000000bb',
          snapshot: { name: 'Mosaic', alphaAcid_pct: 12, form: 'pellet' },
          amount_g: 60,
          time_min: 4320,
          use: 'dry-hop',
        },
      ],
      miscs: [
        {
          ingredientId: '00000000-0000-0000-0000-0000000000cc',
          snapshot: { name: 'Whirlfloc', type: 'fining' },
          amount: 1,
          amountUnit: 'each',
          use: 'boil',
          time_min: 15,
        },
      ],
    } as Recipe
    const choices: ProcessChoices = { carbPath: 'nitro' }
    const active = resolveBranches(BREW_MANUAL, r, choices, vols)
    expect(active.has('ramp-next-step')).toBe(true)
    expect(active.has('mash-out')).toBe(true)
    expect(active.has('whirlpool-hopstand')).toBe(true)
    expect(active.has('closed-dry-hop')).toBe(true)
    expect(active.has('weigh-adjuncts')).toBe(true)
    expect(active.has('oxygenate-wort')).toBe(true) // pressureFromPitch unset
    expect(active.has('nitro-dispense-beergas')).toBe(true)
    expect(active.has('co2-set-regulator')).toBe(false)
  })

  it('every step has the required ProcessStep arrays present', () => {
    for (const s of allSteps()) {
      expect(Array.isArray(s.values)).toBe(true)
      expect(Array.isArray(s.logs)).toBe(true)
      expect(Array.isArray(s.timers)).toBe(true)
      expect(typeof s.title).toBe('string')
      expect(s.title.length).toBeGreaterThan(0)
    }
  })
})
