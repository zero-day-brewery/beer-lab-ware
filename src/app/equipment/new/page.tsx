import { Suspense } from 'react'
import { EquipmentEditView } from '@/components/equipment/equipment-edit-view'

export default function NewEquipmentPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>}
    >
      <EquipmentEditView mode="new" />
    </Suspense>
  )
}
