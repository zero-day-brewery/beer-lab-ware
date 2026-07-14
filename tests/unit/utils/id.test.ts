import { describe, expect, it } from 'vitest'
import { isUUID, newId } from '@/lib/utils/id'

describe('id utils', () => {
  it('newId() returns a valid uuid v4', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('newId() is unique across many calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(newId())
    expect(ids.size).toBe(1000)
  })

  it('isUUID() returns true for valid uuid', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('isUUID() returns false for garbage', () => {
    expect(isUUID('not-a-uuid')).toBe(false)
    expect(isUUID('')).toBe(false)
  })
})
