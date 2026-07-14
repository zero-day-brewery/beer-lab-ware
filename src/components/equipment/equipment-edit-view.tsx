'use client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { type UseFormReturn, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { type EquipmentProfile, EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import { equipmentRepo } from '@/lib/db/repos/equipment'
import { newId } from '@/lib/utils/id'

const newDefaults = (): EquipmentProfile => ({
  id: newId(),
  name: '',
  isDefault: false,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 1,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.2,
  evaporationRate_LperHr: 3,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.04,
  mashEfficiency_pct: 80,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1,
  calibrationNotes_md: '',
  schemaVersion: 1,
})

type NumFieldProps = {
  label: string
  name: keyof EquipmentProfile
  form: UseFormReturn<EquipmentProfile>
  step?: string
}

function NumField({ label, name, form, step = '0.1' }: NumFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs">{label}</span>
      <input
        type="number"
        step={step}
        aria-label={label}
        {...form.register(name, { valueAsNumber: true })}
        className="field"
      />
    </label>
  )
}

export function EquipmentEditView({ mode }: { mode: 'new' | 'edit' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Edit-mode id comes from ?id= (static-export-safe; a dynamic [id] segment 404s
  // on client nav under output:export). See recipe routes for the same pattern.
  const routeId = mode === 'edit' ? searchParams.get('id') || undefined : undefined

  const form = useForm<EquipmentProfile>({
    resolver: zodResolver(EquipmentProfileSchema),
    defaultValues: newDefaults(),
    mode: 'onSubmit',
  })

  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>(
    mode === 'edit' ? 'loading' : 'ready',
  )

  useEffect(() => {
    if (mode !== 'edit') return
    if (!routeId) {
      setStatus('notfound')
      return
    }
    let cancelled = false
    equipmentRepo
      .get(routeId)
      .then((loaded) => {
        if (cancelled) return
        if (loaded) {
          form.reset(loaded)
          setStatus('ready')
        } else {
          setStatus('notfound')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('notfound')
      })
    return () => {
      cancelled = true
    }
  }, [mode, routeId, form])

  const onSubmit = async (p: EquipmentProfile) => {
    try {
      const saved = await equipmentRepo.save(p)
      toast.success(`Saved "${saved.name}"`)
      router.push('/equipment')
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`)
    }
  }

  const {
    register,
    formState: { errors },
  } = form

  if (status === 'loading') {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading profile…</p>
  }
  if (status === 'notfound') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">That equipment profile could not be found.</p>
        <button type="button" onClick={() => router.push('/equipment')} className="btn-ghost">
          Back to equipment
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-6">
        <div>
          <span className="eyebrow">🛠️ Rig</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {mode === 'new' ? 'New equipment profile' : 'Edit equipment profile'}
          </h1>
        </div>
        <button type="submit" className="btn-primary">
          Save
        </button>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Name</span>
          <input aria-label="Name" {...register('name')} className="field" placeholder="B40 Pro" />
          {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" {...register('isDefault')} />
          <span className="text-sm font-medium">Default profile</span>
        </label>
      </section>

      <fieldset className="rounded-lg border border-border bg-card/40 p-4">
        <legend className="px-2 text-sm font-semibold">Volumes (L)</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <NumField label="Mash tun volume" name="mashTunVolume_L" form={form} />
          <NumField label="Mash tun dead space" name="mashTunDeadSpace_L" form={form} />
          <NumField label="Kettle volume" name="kettleVolume_L" form={form} />
          <NumField label="Kettle dead space" name="kettleDeadSpace_L" form={form} />
          <NumField label="Fermenter volume" name="fermenterVolume_L" form={form} />
          <NumField label="Fermenter dead space" name="fermenterDeadSpace_L" form={form} />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-card/40 p-4">
        <legend className="px-2 text-sm font-semibold">Process</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <NumField label="Evaporation rate (L/hr)" name="evaporationRate_LperHr" form={form} />
          <NumField label="Cooling shrinkage (%)" name="coolingShrinkage_pct" form={form} />
          <NumField label="Top-up kettle (L)" name="topUpKettle_L" form={form} />
          <NumField label="Top-up water (L)" name="topUpWater_L" form={form} />
          <NumField
            label="Grain absorption (L/kg)"
            name="grainAbsorption_LperKg"
            form={form}
            step="0.01"
          />
          <NumField
            label="Hop utilization mult."
            name="hopUtilizationMultiplier"
            form={form}
            step="0.05"
          />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-card/40 p-4">
        <legend className="px-2 text-sm font-semibold">Efficiency (%)</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <NumField label="Mash efficiency" name="mashEfficiency_pct" form={form} />
          <NumField label="Brewhouse efficiency" name="brewhouseEfficiency_pct" form={form} />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-card/40 p-4">
        <legend className="px-2 text-sm font-semibold">Formulas</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs">IBU formula</span>
            <select {...register('ibuFormula')} className="field">
              <option value="tinseth">tinseth</option>
              <option value="rager">rager</option>
              <option value="garetz">garetz</option>
              <option value="daniels">daniels</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs">SRM formula</span>
            <select {...register('srmFormula')} className="field">
              <option value="morey">morey</option>
              <option value="daniels">daniels</option>
              <option value="mosher">mosher</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs">ABV formula</span>
            <select {...register('abvFormula')} className="field">
              <option value="simple">simple</option>
              <option value="advanced">advanced</option>
            </select>
          </label>
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Calibration notes</span>
        <textarea {...register('calibrationNotes_md')} rows={3} className="field" />
      </label>
    </form>
  )
}
