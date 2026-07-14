'use client'
import { useFormContext } from 'react-hook-form'
import { BJCP_2021_STYLES } from '@/lib/brewing/styles/bjcp-2021'
import type { Recipe } from '@/lib/brewing/types/recipe'

export function StylePicker() {
  const { register } = useFormContext<Recipe>()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">Style (BJCP 2021)</span>
      <select
        {...register('styleId')}
        aria-label="Style (BJCP 2021)"
        className="rounded border border-input bg-background px-2 py-1.5 text-sm"
      >
        <option value="">(none)</option>
        {BJCP_2021_STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id} — {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
