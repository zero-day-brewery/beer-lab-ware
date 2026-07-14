import { describe, expect, it } from 'vitest'
import { allTags, filterRecipes } from '@/lib/brewing/recipe/filter'
import type { Recipe } from '@/lib/brewing/types/recipe'

const base: Omit<Recipe, 'id' | 'name'> = {
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-11T12:00:00.000Z',
  updatedAt: '2026-05-11T12:00:00.000Z',
  schemaVersion: 1,
}

function recipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return { ...base, id, name, ...extra }
}

const ipa = recipe('550e8400-e29b-41d4-a716-446655440001', 'West Coast IPA', {
  styleId: '21A',
  tags: ['ipa', 'house'],
})
const stout = recipe('550e8400-e29b-41d4-a716-446655440002', 'Dry Stout', {
  styleId: '15B',
  tags: ['stout', 'dark'],
})
const legacy = recipe('550e8400-e29b-41d4-a716-446655440003', 'Old Ale') // no tags key
const all = [ipa, stout, legacy]

describe('filterRecipes', () => {
  it('returns everything when search + tags are empty', () => {
    expect(filterRecipes(all, { search: '', tags: [] })).toEqual(all)
    expect(filterRecipes(all)).toEqual(all)
  })

  it('matches on name (case-insensitive)', () => {
    expect(filterRecipes(all, { search: 'stout' }).map((r) => r.name)).toEqual(['Dry Stout'])
    expect(filterRecipes(all, { search: 'WEST' }).map((r) => r.name)).toEqual(['West Coast IPA'])
  })

  it('matches on styleId (case-insensitive)', () => {
    expect(filterRecipes(all, { search: '21a' }).map((r) => r.name)).toEqual(['West Coast IPA'])
  })

  it('matches on a tag value', () => {
    expect(filterRecipes(all, { search: 'dark' }).map((r) => r.name)).toEqual(['Dry Stout'])
  })

  it('applies AND semantics across selected tags', () => {
    expect(filterRecipes(all, { tags: ['ipa', 'house'] }).map((r) => r.name)).toEqual([
      'West Coast IPA',
    ])
    // A recipe missing one of the selected tags is excluded.
    expect(filterRecipes(all, { tags: ['ipa', 'dark'] })).toEqual([])
  })

  it('combines tag filter AND search', () => {
    expect(filterRecipes(all, { tags: ['ipa'], search: 'coast' }).map((r) => r.name)).toEqual([
      'West Coast IPA',
    ])
    expect(filterRecipes(all, { tags: ['ipa'], search: 'stout' })).toEqual([])
  })

  it('treats a legacy recipe with no tags as untagged', () => {
    expect(filterRecipes(all, { tags: ['ipa'] })).not.toContain(legacy)
    expect(filterRecipes([legacy], { search: 'old' })).toEqual([legacy])
  })

  it('trims whitespace-only searches to "match all"', () => {
    expect(filterRecipes(all, { search: '   ' })).toEqual(all)
  })

  it('does not mutate the input array', () => {
    const snapshot = [...all]
    filterRecipes(all, { search: 'ipa', tags: ['house'] })
    expect(all).toEqual(snapshot)
  })
})

describe('allTags', () => {
  it('returns sorted, de-duplicated tags across all recipes', () => {
    expect(allTags(all)).toEqual(['dark', 'house', 'ipa', 'stout'])
  })

  it('de-dupes tags shared by multiple recipes', () => {
    const a = recipe('550e8400-e29b-41d4-a716-446655440010', 'A', { tags: ['house', 'ipa'] })
    const b = recipe('550e8400-e29b-41d4-a716-446655440011', 'B', { tags: ['house', 'stout'] })
    expect(allTags([a, b])).toEqual(['house', 'ipa', 'stout'])
  })

  it('returns [] when no recipe has tags', () => {
    expect(allTags([legacy])).toEqual([])
    expect(allTags([])).toEqual([])
  })
})
