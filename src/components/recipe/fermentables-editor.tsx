'use client'
import { useFieldArray, useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { newId } from '@/lib/utils/id'

export function FermentablesEditor() {
  const { register, control } = useFormContext<Recipe>()
  const { fields, append, remove } = useFieldArray({ control, name: 'fermentables' })

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Fermentables</h2>
        <button
          type="button"
          onClick={() =>
            append({
              ingredientId: newId(),
              snapshot: { name: '', type: 'base', ppg: 37, color_L: 2 },
              amount_kg: 0,
              usage: 'mash',
              afterBoil: false,
            })
          }
          className="rounded border border-border bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:opacity-80"
        >
          Add fermentable
        </button>
      </header>

      {fields.length === 0 ? (
        <p className="subeditor-empty">
          <span aria-hidden="true">🌾</span> No fermentables yet — add your base malt to start the
          grain bill.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Fermentable name</span>
                  <input
                    aria-label="fermentable name"
                    {...register(`fermentables.${i}.snapshot.name` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Type</span>
                  <select
                    {...register(`fermentables.${i}.snapshot.type` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="base">base</option>
                    <option value="specialty">specialty</option>
                    <option value="adjunct">adjunct</option>
                    <option value="extract">extract</option>
                    <option value="sugar">sugar</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">PPG</span>
                  <input
                    type="number"
                    step="1"
                    {...register(`fermentables.${i}.snapshot.ppg` as const, {
                      valueAsNumber: true,
                    })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Color (°L)</span>
                  <input
                    type="number"
                    step="0.5"
                    {...register(`fermentables.${i}.snapshot.color_L` as const, {
                      valueAsNumber: true,
                    })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Amount (kg)</span>
                  <input
                    aria-label="amount"
                    type="number"
                    step="0.05"
                    {...register(`fermentables.${i}.amount_kg` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Usage</span>
                  <select
                    {...register(`fermentables.${i}.usage` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="mash">mash</option>
                    <option value="sparge">sparge</option>
                    <option value="boil">boil</option>
                    <option value="fermenter">fermenter</option>
                    <option value="bottling">bottling</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 md:mt-5">
                  <input type="checkbox" {...register(`fermentables.${i}.afterBoil` as const)} />
                  <span className="text-xs">After boil</span>
                </label>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="remove fermentable"
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
