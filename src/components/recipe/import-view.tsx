'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { BrewfatherImportSection } from '@/components/recipe/brewfather-import'
import { parseBeerXML } from '@/lib/brewing/beerxml/parse'
import { recipeRepo } from '@/lib/db/repos/recipe'

export function ImportView() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File) => {
    setBusy(true)
    try {
      const xml = await file.text()
      let recipes: ReturnType<typeof parseBeerXML>
      try {
        recipes = parseBeerXML(xml)
      } catch (err) {
        toast.error(`Could not read file: ${(err as Error).message}`)
        return
      }
      if (recipes.length === 0) {
        toast.warning('No recipes found in file')
        return
      }

      // Import each recipe independently — one bad recipe must not abort the batch.
      let saved = 0
      const failures: string[] = []
      for (const r of recipes) {
        try {
          await recipeRepo.save(r)
          saved += 1
        } catch (err) {
          const label = r.name ? `"${r.name}"` : 'a recipe'
          failures.push(`${label}: ${(err as Error).message}`)
        }
      }

      const total = recipes.length
      if (failures.length === 0) {
        toast.success(`Imported ${saved} recipe${saved === 1 ? '' : 's'}`)
        router.push('/')
      } else if (saved === 0) {
        toast.error(`Import failed: 0 of ${total} recipes imported. ${failures.join('; ')}`)
      } else {
        toast.warning(
          `Imported ${saved} of ${total} recipes; ${failures.length} failed: ${failures.join('; ')}`,
        )
        router.push('/')
      }
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="border-b border-border/70 pb-6">
        <span className="eyebrow">📥 Import</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Import your brewery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring recipes in via BeerXML, or migrate your whole Brewfather history — batches,
          readings, and inventory included.
        </p>
      </header>
      <div className="tap-card flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold">BeerXML recipes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a BeerXML 1.0 file exported from your other brewing software (BeerSmith,
            Grainfather, etc.). All recipes in the file will be imported.
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">BeerXML file</span>
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            aria-label="BeerXML file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
            className="field"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Equipment profile must be assigned manually after import — the BeerXML schema doesn't
          carry our equipment FK.
        </p>
      </div>
      <BrewfatherImportSection />
    </div>
  )
}
