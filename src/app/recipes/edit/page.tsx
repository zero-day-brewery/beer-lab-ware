import { Suspense } from 'react'
import { RecipeEditView } from '@/components/recipe/recipe-edit-view'

// Static route; the recipe id is read client-side from ?id= (export-safe).
export default function EditRecipePage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading recipe…</p>}
    >
      <RecipeEditView mode="edit" />
    </Suspense>
  )
}
