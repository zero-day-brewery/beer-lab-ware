// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrewfatherImportSection } from '@/components/recipe/brewfather-import'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

const importMocks = vi.hoisted(() => ({
  buildBrewfatherPlan: vi.fn(),
  executeBrewfatherImport: vi.fn(),
}))
vi.mock('@/lib/brewing/brewfather/import', () => importMocks)

function fakePlan(overrides?: Partial<ReturnType<typeof basePlan>>) {
  return { ...basePlan(), ...overrides }
}
function basePlan() {
  return {
    recipes: [],
    batches: [],
    inventory: [],
    counts: { recipes: 3, batches: 2, readings: 14, inventoryItems: 9 },
    skippedEntities: 1,
    warnings: ['Recipe "X": boil time missing — defaulted to 0 min'],
  }
}

function fileWith(text: string, name = 'recipes.json'): File {
  const f = new File([text], name, { type: 'application/json' })
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) })
  return f
}

function uploadFiles(...files: File[]) {
  const input = screen.getByLabelText(/brewfather json files/i) as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

describe('BrewfatherImportSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Brewfather hint and file picker', () => {
    render(<BrewfatherImportSection />)
    expect(screen.getByText(/coming from brewfather\?/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/brewfather json files/i)).toBeInTheDocument()
    // Preview/import controls only appear once files are chosen.
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument()
  })

  it('shows a dry-run preview with per-entity counts and warnings before importing', async () => {
    importMocks.buildBrewfatherPlan.mockReturnValue(fakePlan())
    render(<BrewfatherImportSection />)
    uploadFiles(fileWith('[]'))

    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument())
    expect(importMocks.buildBrewfatherPlan).toHaveBeenCalledTimes(1)
    // Nothing written during preview.
    expect(importMocks.executeBrewfatherImport).not.toHaveBeenCalled()

    expect(screen.getByText('Recipes')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Batches')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('Inventory items')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText(/1 warning/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import 28 items/i })).toBeEnabled()
  })

  it('passes file name + text through to the planner', async () => {
    importMocks.buildBrewfatherPlan.mockReturnValue(fakePlan())
    render(<BrewfatherImportSection />)
    uploadFiles(fileWith('[1]', 'batches.json'), fileWith('[2]', 'hops.json'))

    await waitFor(() => expect(importMocks.buildBrewfatherPlan).toHaveBeenCalled())
    expect(importMocks.buildBrewfatherPlan).toHaveBeenCalledWith([
      { fileName: 'batches.json', text: '[1]' },
      { fileName: 'hops.json', text: '[2]' },
    ])
  })

  it('imports on confirm and shows the result summary', async () => {
    const plan = fakePlan()
    importMocks.buildBrewfatherPlan.mockReturnValue(plan)
    importMocks.executeBrewfatherImport.mockResolvedValue({
      imported: { recipes: 3, batches: 2, readings: 14, inventoryItems: 9 },
      skippedExisting: { recipes: 0, batches: 0, readings: 0, inventoryItems: 0 },
      warnings: [],
    })
    render(<BrewfatherImportSection />)
    uploadFiles(fileWith('[]'))
    await waitFor(() => screen.getByRole('button', { name: /import 28 items/i }))

    fireEvent.click(screen.getByRole('button', { name: /import 28 items/i }))
    await waitFor(() => expect(importMocks.executeBrewfatherImport).toHaveBeenCalledWith(plan))
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
    expect(
      screen.getByText(/3 recipes, 2 batches, 14 readings, 9 inventory items/i),
    ).toBeInTheDocument()
    expect(toastMocks.success).toHaveBeenCalled()
  })

  it('reports an all-duplicates re-import without duplicating', async () => {
    importMocks.buildBrewfatherPlan.mockReturnValue(fakePlan())
    importMocks.executeBrewfatherImport.mockResolvedValue({
      imported: { recipes: 0, batches: 0, readings: 0, inventoryItems: 0 },
      skippedExisting: { recipes: 3, batches: 2, readings: 14, inventoryItems: 9 },
      warnings: [],
    })
    render(<BrewfatherImportSection />)
    uploadFiles(fileWith('[]'))
    await waitFor(() => screen.getByRole('button', { name: /import 28 items/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 28 items/i }))

    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
    expect(screen.getByText(/nothing was duplicated/i)).toBeInTheDocument()
    expect(toastMocks.info).toHaveBeenCalled()
  })

  it('disables the import button when nothing is importable', async () => {
    importMocks.buildBrewfatherPlan.mockReturnValue(
      fakePlan({
        counts: { recipes: 0, batches: 0, readings: 0, inventoryItems: 0 },
        warnings: ['recipes.json: not valid JSON — file skipped'],
      }),
    )
    render(<BrewfatherImportSection />)
    uploadFiles(fileWith('{ not json'))
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /import 0 items/i })).toBeDisabled()
    expect(screen.getByText(/1 warning/)).toBeInTheDocument()
  })
})
