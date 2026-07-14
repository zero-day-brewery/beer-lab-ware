// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import { db } from '@/lib/db/schema'
import { useEquipmentStore } from '@/stores/equipment-store'

const b40: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
  isDefault: true,
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
}

describe('useEquipmentStore', () => {
  beforeEach(async () => {
    await db.equipmentProfiles.clear()
  })
  afterEach(async () => {
    await db.equipmentProfiles.clear()
  })

  it('starts empty', async () => {
    const { result } = renderHook(() => useEquipmentStore())
    await waitFor(() => expect(result.current.profiles).toEqual([]))
  })

  it('updates reactively when a profile is added', async () => {
    const { result } = renderHook(() => useEquipmentStore())
    await act(async () => {
      await db.equipmentProfiles.put(b40)
    })
    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1)
      expect(result.current.profiles[0].name).toBe('B40 Pro')
    })
  })
})
