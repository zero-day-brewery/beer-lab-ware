import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '@/lib/brewing/types/settings'

describe('SettingsSchema.gravityUnit', () => {
  it('parses old rows with no gravityUnit (stays undefined; consumers default to sg)', () => {
    const parsed = SettingsSchema.parse({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
      theme: 'default',
      schemaVersion: 1,
    })
    expect(parsed.gravityUnit).toBeUndefined()
  })
  it('accepts plato', () => {
    const parsed = SettingsSchema.parse({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
      theme: 'default',
      gravityUnit: 'plato',
      schemaVersion: 1,
    })
    expect(parsed.gravityUnit).toBe('plato')
  })
})
