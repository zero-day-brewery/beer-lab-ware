import { Suspense } from 'react'
import { RecipeEditView } from '@/components/recipe/recipe-edit-view'

export default function NewRecipePage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>}
    >
      <RecipeEditView mode="new" />
    </Suspense>
  )
}
