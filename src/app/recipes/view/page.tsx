import { Suspense } from 'react'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'

// Static route; the recipe id is read client-side from ?id= (export-safe).
export default function RecipeViewPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading recipe…</p>}
    >
      <RecipeDetailView />
    </Suspense>
  )
}
