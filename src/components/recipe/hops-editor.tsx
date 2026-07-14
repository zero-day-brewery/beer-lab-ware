'use client'
import { useFieldArray, useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { newId } from '@/lib/utils/id'

export function HopsEditor() {
  const { register, control } = useFormContext<Recipe>()
  const { fields, append, remove } = useFieldArray({ control, name: 'hops' })

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Hops</h2>
        <button
          type="button"
          onClick={() =>
            append({
              ingredientId: newId(),
              snapshot: { name: '', alphaAcid_pct: 5, form: 'pellet' },
              amount_g: 28,
              time_min: 60,
              use: 'boil',
            })
          }
          className="rounded border border-border bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:opacity-80"
        >
          Add hop
        </button>
      </header>

      {fields.length === 0 ? (
        <p className="subeditor-empty">
          <span aria-hidden="true">🌿</span> No hops in the bill yet — add the first addition.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Hop name</span>
                  <input
                    aria-label="hop name"
                    {...register(`hops.${i}.snapshot.name` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Alpha acid (%)</span>
                  <input
                    aria-label="alpha acid"
                    type="number"
                    step="0.1"
                    {...register(`hops.${i}.snapshot.alphaAcid_pct` as const, {
                      valueAsNumber: true,
                    })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Form</span>
                  <select
                    {...register(`hops.${i}.snapshot.form` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="pellet">pellet</option>
                    <option value="leaf">leaf</option>
                    <option value="plug">plug</option>
                    <option value="extract">extract</option>
                    <option value="cryo">cryo</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Amount (g)</span>
                  <input
                    type="number"
                    step="1"
                    {...register(`hops.${i}.amount_g` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Time (min)</span>
                  <input
                    type="number"
                    step="1"
                    {...register(`hops.${i}.time_min` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Use</span>
                  <select
                    {...register(`hops.${i}.use` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="boil">boil</option>
                    <option value="first-wort">first-wort</option>
                    <option value="whirlpool">whirlpool</option>
                    <option value="aroma">aroma</option>
                    <option value="dry-hop">dry-hop</option>
                    <option value="mash">mash</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="remove hop"
                  className="self-end btn-ghost danger"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
