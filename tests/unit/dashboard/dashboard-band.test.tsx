// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RecipeListView } from '@/components/recipe/recipe-list-view'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { db } from '@/lib/db/schema'
import { useSystemStore } from '@/stores/system-store'

const recipeA: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'IPA #1',
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

const lowStockItem: InventoryItem = {
  id: '550e8400-e29b-41d4-a716-4466554400aa',
  name: 'Cascade Hops',
  ingredientKind: 'hop',
  amount: 5,
  amountUnit: 'g',
  lowStockThreshold: 100,
  status: 'sealed',
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

function resetSystemBoard() {
  useSystemStore.setState({
    fermenters: [{ id: 'f1', name: 'Fermenter 1', batch: '', status: 'empty' }],
    brewSystems: [{ id: 'b1', name: 'Brew System', components: [], status: 'idle' }],
    coolers: [
      { id: 'glycol', kind: 'glycol', name: 'Glycol Cooler', components: [], status: 'idle' },
    ],
    currentBrew: null,
  })
}

// liveQuery-backed assertions need a little slack: several singleton stores
// (recipes/inventory/batches) feed one component, and their async emits can
// queue up under a loaded event loop.
const LQ = { timeout: 4000 }

describe('Recipes-Home dashboard band', () => {
  // Keep a recipe present for the whole block so RecipeListView never flips into
  // its EmptyState branch (which would unmount the dashboard) between tests.
  beforeAll(async () => {
    await db.recipes.clear()
    await db.recipes.put(recipeA)
  })
  afterAll(async () => {
    await db.recipes.clear()
  })
  beforeEach(async () => {
    await db.inventoryItems.clear()
    await db.batches.clear()
    resetSystemBoard()
  })
  afterEach(async () => {
    await db.inventoryItems.clear()
    await db.batches.clear()
    resetSystemBoard()
  })

  it('renders the dashboard band ABOVE the recipe list', async () => {
    render(<RecipeListView />)

    const band = await screen.findByRole('region', { name: /brewery dashboard/i }, LQ)
    const card = await screen.findByText('IPA #1', {}, LQ)
    // Band must precede the recipe card in document order.
    expect(band.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows an active-fermentation card for a fermenting vessel', async () => {
    useSystemStore.setState({
      fermenters: [
        {
          id: 'f1',
          name: 'Fermenter 1',
          batch: 'Test Ferment',
          status: 'fermenting',
          og: 1.05,
          sg: 1.02,
          fg: 1.01,
          pitchedAt: '2026-07-01T12:00:00.000Z',
        },
      ],
    })
    render(<RecipeListView />)

    expect(await screen.findByText(/active fermentations/i, {}, LQ)).toBeInTheDocument()
    expect(await screen.findByText('Test Ferment', {}, LQ)).toBeInTheDocument()
  })

  it('shows a low-stock attention card when an ingredient is low', async () => {
    await db.inventoryItems.put(lowStockItem)
    render(<RecipeListView />)

    // Target the attention card by its unique title + detail. ("Low stock" alone
    // is ambiguous — it's also the KPI tile label.)
    expect(await screen.findByText(/1 ingredient low/i, {}, LQ)).toBeInTheDocument()
    expect(await screen.findByText(/Cascade Hops/, {}, LQ)).toBeInTheDocument()
  })

  it('shows the all-clear state when nothing needs attention', async () => {
    render(<RecipeListView />)

    expect(await screen.findByText(/all clear/i, {}, LQ)).toBeInTheDocument()
  })

  it('shows the Active Fermentations empty-hint (linking to /system) when no fermenter is active', async () => {
    // resetSystemBoard (beforeEach) leaves a single EMPTY fermenter, so the
    // Active Fermentations section has zero active items and must fall back to
    // the guiding hint rather than vanish.
    render(<RecipeListView />)

    const hint = await screen.findByRole('link', { name: /no active fermentations/i }, LQ)
    expect(hint).toBeInTheDocument()
    expect(hint).toHaveAttribute('href', '/system')
  })

  it('replaces the empty-hint with cards once a vessel is fermenting', async () => {
    useSystemStore.setState({
      fermenters: [
        {
          id: 'f1',
          name: 'Fermenter 1',
          batch: 'Test Ferment',
          status: 'fermenting',
          og: 1.05,
          sg: 1.02,
          fg: 1.01,
          pitchedAt: '2026-07-01T12:00:00.000Z',
        },
      ],
    })
    render(<RecipeListView />)

    // The active card renders...
    expect(await screen.findByText('Test Ferment', {}, LQ)).toBeInTheDocument()
    // ...and the empty-hint is gone.
    expect(screen.queryByText(/no active fermentations/i)).not.toBeInTheDocument()
  })
})

describe('Recipes-Home — no regression', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    resetSystemBoard()
  })
  afterEach(async () => {
    await db.recipes.clear()
    resetSystemBoard()
  })

  it('renders the dashboard band ABOVE the "Brew your first beer" empty state when there are no recipes', async () => {
    render(<RecipeListView />)

    // The EmptyState copy is unchanged...
    const empty = await screen.findByText(/brew your first beer/i, {}, LQ)
    // ...and the dashboard band now renders in the empty branch too.
    const band = await screen.findByRole('region', { name: /brewery dashboard/i }, LQ)
    expect(band).toBeInTheDocument()
    // Band must precede the empty state in document order.
    expect(band.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The empty-state CTA and BeerXML import are still there, unchanged.
    expect(screen.getByRole('link', { name: /import from beerxml/i })).toBeInTheDocument()
  })

  it('still renders the recipe grid alongside the dashboard', async () => {
    await db.recipes.put(recipeA)
    render(<RecipeListView />)
    const band = await screen.findByRole('region', { name: /brewery dashboard/i }, LQ)
    const card = await screen.findByText('IPA #1', {}, LQ)
    // Dashboard still sits above the recipe grid.
    expect(band.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: /new recipe/i })).toBeInTheDocument()
  })
})
