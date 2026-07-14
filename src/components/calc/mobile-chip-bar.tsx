'use client'
import { useMemo } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { useEquipmentStore } from '@/stores/equipment-store'

const fallbackEquipment = B40PRO_PROFILE

export function MobileChipBar() {
  const { control } = useFormContext<Recipe>()
  const recipe = useWatch({ control }) as Recipe
  const { profiles } = useEquipmentStore()
  const equipment = profiles.find((p) => p.id === recipe.equipmentProfileId) ?? fallbackEquipment

  const result = useMemo(() => {
    try {
      return calculateRecipe(recipe, equipment, new Date().toISOString())
    } catch {
      return null
    }
  }, [recipe, equipment])

  if (!result) return null

  const chips = [
    { label: 'OG', value: result.OG.toFixed(3) },
    { label: 'FG', value: result.FG.toFixed(3) },
    { label: 'ABV', value: `${result.ABV.toFixed(1)}%` },
    { label: 'IBU', value: result.IBU.toFixed(0) },
    { label: 'SRM', value: result.SRM.toFixed(1) },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card lg:hidden">
      <div className="grid grid-cols-5">
        {chips.map((c) => (
          <div key={c.label} className="flex flex-col items-center px-1 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">{c.label}</span>
            <span className="font-mono text-xs">{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
