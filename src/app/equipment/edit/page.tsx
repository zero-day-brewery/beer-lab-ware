import { Suspense } from 'react'
import { EquipmentEditView } from '@/components/equipment/equipment-edit-view'

// Static route; the profile id is read client-side from ?id= (export-safe).
export default function EditEquipmentPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading profile…</p>}
    >
      <EquipmentEditView mode="edit" />
    </Suspense>
  )
}
