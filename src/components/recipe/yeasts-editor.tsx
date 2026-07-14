'use client'
import { useFieldArray, useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { newId } from '@/lib/utils/id'

export function YeastsEditor() {
  const { register, control } = useFormContext<Recipe>()
  const { fields, append, remove } = useFieldArray({ control, name: 'yeasts' })

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Yeast</h2>
        <button
          type="button"
          onClick={() =>
            append({
              ingredientId: newId(),
              snapshot: { name: '', attenuation_min_pct: 75, attenuation_max_pct: 82, form: 'dry' },
              amount: 11.5,
            })
          }
          className="rounded border border-border bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:opacity-80"
        >
          Add yeast
        </button>
      </header>

      {fields.length === 0 ? (
        <p className="subeditor-empty">
          <span aria-hidden="true">🧫</span> No yeasts yet — pick a strain to set attenuation.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Yeast name</span>
                  <input
                    aria-label="yeast name"
                    {...register(`yeasts.${i}.snapshot.name` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Form</span>
                  <select
                    {...register(`yeasts.${i}.snapshot.form` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="dry">dry</option>
                    <option value="liquid">liquid</option>
                    <option value="slant">slant</option>
                    <option value="culture">culture</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Atten min (%)</span>
                  <input
                    type="number"
                    step="1"
                    {...register(`yeasts.${i}.snapshot.attenuation_min_pct` as const, {
                      valueAsNumber: true,
                    })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Atten max (%)</span>
                  <input
                    type="number"
                    step="1"
                    {...register(`yeasts.${i}.snapshot.attenuation_max_pct` as const, {
                      valueAsNumber: true,
                    })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Amount</span>
                  <input
                    type="number"
                    step="0.5"
                    {...register(`yeasts.${i}.amount` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="remove yeast"
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
