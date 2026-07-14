'use client'
import { useFieldArray, useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { newId } from '@/lib/utils/id'

export function MiscsEditor() {
  const { register, control } = useFormContext<Recipe>()
  const { fields, append, remove } = useFieldArray({ control, name: 'miscs' })

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Miscellaneous</h2>
        <button
          type="button"
          onClick={() =>
            append({
              ingredientId: newId(),
              snapshot: { name: '', type: 'other' },
              amount: 1,
              amountUnit: 'g',
              use: 'boil',
              time_min: 10,
            })
          }
          className="rounded border border-border bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:opacity-80"
        >
          Add misc
        </button>
      </header>

      {fields.length === 0 ? (
        <p className="subeditor-empty">
          <span aria-hidden="true">⚗️</span> No misc additions yet — water salts, finings, spices.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Name</span>
                  <input
                    aria-label="misc name"
                    {...register(`miscs.${i}.snapshot.name` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Type</span>
                  <select
                    {...register(`miscs.${i}.snapshot.type` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="water-agent">water-agent</option>
                    <option value="fining">fining</option>
                    <option value="spice">spice</option>
                    <option value="flavor">flavor</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Amount</span>
                  <input
                    type="number"
                    step="0.1"
                    {...register(`miscs.${i}.amount` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Unit</span>
                  <select
                    {...register(`miscs.${i}.amountUnit` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                    <option value="tsp">tsp</option>
                    <option value="tbsp">tbsp</option>
                    <option value="each">each</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Use</span>
                  <select
                    {...register(`miscs.${i}.use` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="mash">mash</option>
                    <option value="boil">boil</option>
                    <option value="primary">primary</option>
                    <option value="secondary">secondary</option>
                    <option value="bottling">bottling</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Time (min)</span>
                  <input
                    type="number"
                    step="1"
                    {...register(`miscs.${i}.time_min` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="remove misc"
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
