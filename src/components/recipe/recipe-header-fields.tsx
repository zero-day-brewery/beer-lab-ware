'use client'
import type { UseFormReturn } from 'react-hook-form'
import { UnitNumberInput } from '@/components/ui/unit-number-input'
import { useDisplayUnits } from '@/hooks/use-display-units'
import { unitLabel } from '@/lib/brewing/convert/display-units'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { EquipmentPicker } from './equipment-picker'
import { StylePicker } from './style-picker'

export function RecipeHeaderFields({ form }: { form: UseFormReturn<Recipe> }) {
  const {
    register,
    control,
    formState: { errors },
  } = form
  const units = useDisplayUnits()
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Name</span>
        <input
          {...register('name', { required: 'Name is required' })}
          className="rounded border border-input bg-background px-2 py-1.5 text-sm"
          placeholder="SMaSH Pale Ale"
        />
        {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Type</span>
        <select
          {...register('type')}
          className="rounded border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all-grain">All grain</option>
          <option value="extract">Extract</option>
          <option value="partial-mash">Partial mash</option>
          <option value="cider">Cider</option>
          <option value="mead">Mead</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Batch size ({unitLabel('volume', units)})</span>
        <UnitNumberInput
          control={control}
          name="batchSize_L"
          kind="volume"
          step="0.1"
          className="rounded border border-input bg-background px-2 py-1.5 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Boil time (min)</span>
        <input
          type="number"
          step="1"
          {...register('boilTime_min', { valueAsNumber: true, required: true, min: 0 })}
          className="rounded border border-input bg-background px-2 py-1.5 text-sm"
        />
      </label>

      <StylePicker />
      <EquipmentPicker />
    </div>
  )
}
