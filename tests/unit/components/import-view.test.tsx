// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportView } from '@/components/recipe/import-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

const saveMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/repos/recipe', () => ({ recipeRepo: { save: saveMock } }))

const parseMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/brewing/beerxml/parse', () => ({ parseBeerXML: parseMock }))

function fakeRecipe(name: string) {
  return { id: name, name }
}

function fileWith(text: string): File {
  const f = new File([text], 'recipes.xml', { type: 'text/xml' })
  // jsdom File.text() is flaky across versions; stub it.
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) })
  return f
}

function uploadFile(file: File) {
  const input = screen.getByLabelText(/beerxml/i) as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ImportView', () => {
  beforeEach(() => {
    saveMock.mockReset()
    parseMock.mockReset()
    toastMocks.success.mockReset()
    toastMocks.error.mockReset()
    toastMocks.warning.mockReset()
    toastMocks.info.mockReset()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders dropzone + instructions', () => {
    render(<ImportView />)
    expect(screen.getByLabelText(/beerxml/i)).toBeInTheDocument()
    expect(screen.getByText(/upload a beerxml/i)).toBeInTheDocument()
  })

  it('imports all recipes and reports success', async () => {
    parseMock.mockReturnValue([fakeRecipe('A'), fakeRecipe('B')])
    saveMock.mockResolvedValue(undefined)
    render(<ImportView />)
    uploadFile(fileWith('<xml/>'))
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2))
    expect(toastMocks.success).toHaveBeenCalledTimes(1)
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('continues the batch when one recipe fails to save and reports a partial summary', async () => {
    parseMock.mockReturnValue([fakeRecipe('A'), fakeRecipe('B'), fakeRecipe('C'), fakeRecipe('D')])
    // Recipe "C" fails; the others succeed.
    saveMock.mockImplementation((r: { name: string }) => {
      if (r.name === 'C') return Promise.reject(new Error('boom'))
      return Promise.resolve(undefined)
    })
    render(<ImportView />)
    uploadFile(fileWith('<xml/>'))

    // All four are attempted — one bad recipe must not abort the batch.
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(4))

    // The user sees a partial-success summary mentioning 3 of 4.
    await waitFor(() => {
      const summaryShown =
        toastMocks.success.mock.calls.some((c) => /3 of 4/i.test(String(c[0]))) ||
        toastMocks.warning.mock.calls.some((c) => /3 of 4/i.test(String(c[0])))
      expect(summaryShown).toBe(true)
    })
  })

  it('warns when the file has no recipes', async () => {
    parseMock.mockReturnValue([])
    render(<ImportView />)
    uploadFile(fileWith('<xml/>'))
    await waitFor(() => expect(toastMocks.warning).toHaveBeenCalled())
    expect(saveMock).not.toHaveBeenCalled()
  })
})
