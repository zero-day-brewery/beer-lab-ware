import Link from 'next/link'
import type { Recipe } from '@/lib/brewing/types/recipe'

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <Link
      href={`/recipes/view/?id=${recipe.id}`}
      className="tap-card block p-5 text-card-foreground"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base leading-snug">{recipe.name}</h3>
        <span
          className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--primary) 15%, transparent)',
            color: 'var(--primary)',
          }}
        >
          {recipe.type.replace('-', ' ')}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {recipe.batchSize_L}L batch · {recipe.boilTime_min}min boil
      </p>
      {recipe.tags && recipe.tags.length > 0 && (
        <div className="chip-row mt-3">
          {recipe.tags.map((tag) => (
            <span key={tag} className="flow-chip">
              #{tag}
            </span>
          ))}
        </div>
      )}
      {recipe.styleId && (
        <p className="mt-3 text-xs text-muted-foreground">
          Style: <span className="font-mono">{recipe.styleId}</span>
        </p>
      )}
    </Link>
  )
}
