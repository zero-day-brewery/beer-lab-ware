import { describe, expect, it } from 'vitest'
import { type EquipmentProfile, EquipmentProfileSchema } from '@/lib/brewing/types/equipment'

const validProfile: EquipmentProfile = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  name: 'B40 Pro',
  isDefault: true,
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 1.0,
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.2,
  evaporationRate_LperHr: 3.0,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.04,
  mashEfficiency_pct: 80,
  brewhouseEfficiency_pct: 72,
  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1.0,
  calibrationDate: '2026-05-11T00:00:00.000Z',
  calibrationNotes_md: 'Initial measurements pending.',
  schemaVersion: 1,
}

describe('EquipmentProfileSchema', () => {
  it('accepts a valid B40 Pro profile', () => {
    expect(() => EquipmentProfileSchema.parse(validProfile)).not.toThrow()
  })

  it('rejects negative volumes', () => {
    expect(() => EquipmentProfileSchema.parse({ ...validProfile, kettleVolume_L: -1 })).toThrow()
  })

  it('rejects efficiency outside 0–100%', () => {
    expect(() =>
      EquipmentProfileSchema.parse({ ...validProfile, mashEfficiency_pct: 150 }),
    ).toThrow()
  })

  it('rejects unknown ibuFormula', () => {
    expect(() =>
      EquipmentProfileSchema.parse({ ...validProfile, ibuFormula: 'voodoo' as 'tinseth' }),
    ).toThrow()
  })

  it('rejects when fermenterVolume_L < fermenterDeadSpace_L (impossible)', () => {
    expect(() =>
      EquipmentProfileSchema.parse({
        ...validProfile,
        fermenterVolume_L: 5,
        fermenterDeadSpace_L: 10,
      }),
    ).toThrow()
  })
})
