import { describe, expect, it } from 'vitest'
import { type Settings, SettingsSchema } from '@/lib/brewing/types/settings'

describe('SettingsSchema', () => {
  it('accepts a valid settings object', () => {
    const valid: Settings = {
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'matrix',
      schemaVersion: 1,
    }
    expect(() => SettingsSchema.parse(valid)).not.toThrow()
  })

  it('rejects id other than "global"', () => {
    expect(() =>
      SettingsSchema.parse({
        id: 'something-else',
        units: 'metric',
        defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
        theme: 'matrix',
        schemaVersion: 1,
      }),
    ).toThrow()
  })

  it('rejects unknown theme values', () => {
    expect(() =>
      SettingsSchema.parse({
        id: 'global',
        units: 'metric',
        defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
        theme: 'rainbow',
        schemaVersion: 1,
      }),
    ).toThrow()
  })

  it('rejects non-uuid defaultEquipmentProfileId', () => {
    expect(() =>
      SettingsSchema.parse({
        id: 'global',
        units: 'metric',
        defaultEquipmentProfileId: 'not-a-uuid',
        theme: 'matrix',
        schemaVersion: 1,
      }),
    ).toThrow()
  })
})
