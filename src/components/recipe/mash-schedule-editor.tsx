'use client'
import { useFieldArray, useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'

export function MashScheduleEditor() {
  const { register, control } = useFormContext<Recipe>()
  const { fields, append, remove } = useFieldArray({ control, name: 'mashSteps' })

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Mash schedule</h2>
        <button
          type="button"
          onClick={() =>
            append({ name: 'Saccharification', type: 'infusion', temperature_C: 66, time_min: 60 })
          }
          className="rounded border border-border bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:opacity-80"
        >
          Add step
        </button>
      </header>

      {fields.length === 0 ? (
        <p className="subeditor-empty">
          <span aria-hidden="true">♨️</span> No mash steps yet — add a saccharification rest.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <div key={f.id} className="rounded border border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Step name</span>
                  <input
                    aria-label="step name"
                    {...register(`mashSteps.${i}.name` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Type</span>
                  <select
                    {...register(`mashSteps.${i}.type` as const)}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="infusion">infusion</option>
                    <option value="temperature">temperature</option>
                    <option value="decoction">decoction</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Temperature (°C)</span>
                  <input
                    aria-label="temperature"
                    type="number"
                    step="0.5"
                    {...register(`mashSteps.${i}.temperature_C` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs">Time (min)</span>
                  <input
                    aria-label="time"
                    type="number"
                    step="1"
                    {...register(`mashSteps.${i}.time_min` as const, { valueAsNumber: true })}
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="remove step"
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
