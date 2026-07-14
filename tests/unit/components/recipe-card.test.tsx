// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecipeCard } from '@/components/recipe/recipe-card'
import type { Recipe } from '@/lib/brewing/types/recipe'

const base: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'West Coast IPA',
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
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('RecipeCard tags', () => {
  it('renders a chip per tag when tags are present', () => {
    render(<RecipeCard recipe={{ ...base, tags: ['ipa', 'house'] }} />)
    expect(screen.getByText('#ipa')).toBeInTheDocument()
    expect(screen.getByText('#house')).toBeInTheDocument()
  })

  it('renders no tag chips when tags are absent', () => {
    render(<RecipeCard recipe={base} />)
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument()
  })

  it('renders no tag chips for an empty tags array', () => {
    render(<RecipeCard recipe={{ ...base, tags: [] }} />)
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument()
  })
})
