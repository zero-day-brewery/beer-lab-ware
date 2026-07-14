'use client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { CalculationPanel } from '@/components/calc/calculation-panel'
import { MobileChipBar } from '@/components/calc/mobile-chip-bar'
import { serializeBeerXML } from '@/lib/brewing/beerxml/serialize'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { newId } from '@/lib/utils/id'
import { FermentablesEditor } from './fermentables-editor'
import { HopsEditor } from './hops-editor'
import { MashScheduleEditor } from './mash-schedule-editor'
import { MiscsEditor } from './miscs-editor'
import { RecipeHeaderFields } from './recipe-header-fields'
import { RecipeTagsField } from './recipe-tags-field'
import { YeastsEditor } from './yeasts-editor'

const newRecipeDefaults = (): Recipe => ({
  id: newId(),
  name: '',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [],
  tags: [],
  notes_md: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  schemaVersion: 1,
})

export function RecipeEditView({ mode }: { mode: 'new' | 'edit' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // In edit mode the recipe id comes from the ?id= query param. Query-param routing
  // is static-export-safe (the page is a real static file; no per-id prerender),
  // unlike a dynamic [id] segment which 404s on client nav in `output: export`.
  const routeId = mode === 'edit' ? searchParams.get('id') || undefined : undefined

  const form = useForm<Recipe>({
    resolver: zodResolver(RecipeSchema),
    defaultValues: newRecipeDefaults(),
    mode: 'onSubmit',
  })

  // 'new' is ready immediately; 'edit' stays loading until the record resolves.
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>(
    mode === 'edit' ? 'loading' : 'ready',
  )

  useEffect(() => {
    if (mode !== 'edit') return
    if (!routeId) {
      setStatus('notfound')
      return
    }
    let cancelled = false
    recipeRepo
      .get(routeId)
      .then((loaded) => {
        if (cancelled) return
        if (loaded) {
          form.reset(loaded)
          setStatus('ready')
        } else {
          setStatus('notfound')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('notfound')
      })
    return () => {
      cancelled = true
    }
  }, [mode, routeId, form])

  const onSubmit = async (recipe: Recipe) => {
    try {
      const saved = await recipeRepo.save(recipe)
      toast.success(`Saved "${saved.name}"`)
      router.push(`/recipes/view/?id=${saved.id}`)
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`)
    }
  }

  const onExport = () => {
    const recipe = form.getValues()
    const xml = serializeBeerXML([recipe])
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(recipe.name || 'recipe').replace(/[^a-z0-9-]/gi, '_')}.beerxml.xml`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported BeerXML')
  }

  if (status === 'loading') {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading recipe…</p>
  }
  if (status === 'notfound') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">That recipe could not be found.</p>
        <button type="button" onClick={() => router.push('/')} className="btn-ghost">
          Back to recipes
        </button>
      </div>
    )
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6 pb-16 lg:pb-0">
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{mode === 'new' ? 'New recipe' : 'Edit recipe'}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExport}
              className="rounded border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:opacity-90"
            >
              Export BeerXML
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
          </div>
        </header>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            <RecipeHeaderFields form={form} />
            <FermentablesEditor />
            <HopsEditor />
            <YeastsEditor />
            <MiscsEditor />
            <MashScheduleEditor />
            <RecipeTagsField />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Notes</span>
              <textarea
                {...form.register('notes_md')}
                rows={4}
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                placeholder="Tasting notes, process tweaks, intent…"
              />
            </label>
          </div>
          <div className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
            <CalculationPanel />
          </div>
        </div>
      </form>
      <MobileChipBar />
    </FormProvider>
  )
}
