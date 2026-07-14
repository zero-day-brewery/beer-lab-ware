'use client'
import { useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { useEquipmentStore } from '@/stores/equipment-store'

export function EquipmentPicker() {
  const { register } = useFormContext<Recipe>()
  const { profiles, isLoading } = useEquipmentStore()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">Equipment</span>
      <select
        {...register('equipmentProfileId')}
        aria-label="Equipment"
        className="rounded border border-input bg-background px-2 py-1.5 text-sm"
        disabled={isLoading}
      >
        {profiles.length === 0 ? (
          <option value="">(no profiles yet — add one at /equipment)</option>
        ) : (
          profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))
        )}
      </select>
    </label>
  )
}
