import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeSettingsRepo } from '@/lib/db/repos/settings'
import { BrewDB } from '@/lib/db/schema'

describe('settingsRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeSettingsRepo>

  beforeEach(async () => {
    db = new BrewDB('test-settings')
    await db.open()
    repo = makeSettingsRepo(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-settings')
  })

  it('returns null when settings does not exist', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('saves and retrieves settings', async () => {
    await repo.save({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'matrix',
      schemaVersion: 1,
    })
    const fetched = await repo.get()
    expect(fetched?.theme).toBe('matrix')
  })

  it('rejects invalid settings via Zod', async () => {
    await expect(
      repo.save({
        id: 'global',
        units: 'metric',
        defaultEquipmentProfileId: 'not-a-uuid',
        theme: 'matrix',
        schemaVersion: 1,
      } as never),
    ).rejects.toThrow()
  })

  it('overwrites on re-save', async () => {
    await repo.save({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'matrix',
      schemaVersion: 1,
    })
    await repo.save({
      id: 'global',
      units: 'imperial',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'cyberpunk',
      schemaVersion: 1,
    })
    const fetched = await repo.get()
    expect(fetched?.units).toBe('imperial')
    expect(fetched?.theme).toBe('cyberpunk')
  })
})
