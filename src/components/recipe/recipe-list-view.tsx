'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { RecipesEmptyScene } from '@/components/brand/empty-scenes'
import { Dashboard } from '@/components/dashboard/dashboard'
import { allTags, filterRecipes } from '@/lib/brewing/recipe/filter'
import { useRecipesStore } from '@/stores/recipes-store'
import { RecipeCard } from './recipe-card'

export function RecipeListView() {
  const { recipes, isLoading } = useRecipesStore()
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Tag universe + the client-side filtered view over the store array. Both are
  // memoized so typing/toggling doesn't re-scan on unrelated re-renders.
  const tags = useMemo(() => allTags(recipes), [recipes])
  const visibleRecipes = useMemo(
    () => filterRecipes(recipes, { search, tags: selectedTags }),
    [recipes, search, selectedTags],
  )

  if (isLoading) {
    return <RecipeSkeleton />
  }

  const isFiltering = search.trim() !== '' || selectedTags.length > 0

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))

  // The dashboard band is a "brewhouse at a glance" summary that belongs on the
  // Recipes-Home for EVERY non-loading state — including a brand-new app with
  // zero recipes. It renders at the top, above either the recipe header+grid
  // (non-empty) or the "Brew your first beer" EmptyState (empty).
  return (
    <div className="flex flex-col gap-6">
      <Dashboard />
      {recipes.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-6">
            <div>
              <span className="eyebrow">🍺 On tap</span>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Recipes</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isFiltering
                  ? `${visibleRecipes.length} of ${recipes.length} ${
                      recipes.length === 1 ? 'recipe' : 'recipes'
                    }`
                  : `${recipes.length} ${
                      recipes.length === 1 ? 'recipe' : 'recipes'
                    } · sorted by last update`}
              </p>
            </div>
            <Link href="/recipes/new" className="btn-primary">
              <span aria-hidden="true">+</span>
              <span>New recipe</span>
            </Link>
          </header>

          {/* Controls: search over name/style/tag + tag-filter chips */}
          <div className="flex flex-col gap-3">
            <label className="text-sm" style={{ maxWidth: '24rem' }}>
              <span className="sr-only">Search recipes</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, style, or tag…"
                aria-label="Search recipes"
                className="field w-full"
              />
            </label>
            {tags.length > 0 && (
              <fieldset className="chip-row border-0 p-0">
                <legend className="sr-only">Filter by tag</legend>
                {tags.map((tag) => {
                  const active = selectedTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      aria-pressed={active}
                      className={`btn-ghost ${active ? 'is-active' : ''}`}
                    >
                      #{tag}
                    </button>
                  )
                })}
              </fieldset>
            )}
          </div>

          {visibleRecipes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <h2 className="text-xl font-semibold">No recipes match</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Try a different search term or clear a tag filter.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleRecipes.map((r) => (
                <RecipeCard key={r.id} recipe={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RecipeSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-9 w-40 rounded bg-muted animate-pulse" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 rounded-xl border border-border bg-card animate-pulse opacity-60"
          />
        ))}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <RecipesEmptyScene className="mb-8" />
      <h2 className="text-4xl font-semibold tracking-tight">Brew your first beer</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Pick a BJCP style, dial in the grain bill and hops, and watch the calc panel light up green
        as you nail the vital stats. Then export to BeerXML and brew it.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/recipes/new" className="btn-primary">
          <span aria-hidden="true">+</span>
          <span>New recipe</span>
        </Link>
        <Link
          href="/import"
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:bg-accent hover:text-accent-foreground transition"
        >
          Import from BeerXML
        </Link>
      </div>
      <div className="mt-12 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3 text-left">
        <FeatureChip emoji="🌾" label="Track ingredients" sub="Inventory · vendor · best-by" />
        <FeatureChip emoji="🔬" label="Real-time calc" sub="OG · FG · ABV · IBU · SRM" />
        <FeatureChip emoji="🎯" label="BJCP overlay" sub="Green / amber / red" />
      </div>
    </div>
  )
}

function FeatureChip({ emoji, label, sub }: { emoji: string; label: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-3">
      <div className="text-xl" aria-hidden="true">
        {emoji}
      </div>
      <div className="mt-1 text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
