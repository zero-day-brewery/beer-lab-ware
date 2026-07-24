import { describe, expect, it } from 'vitest'
import { availableFermenters } from '@/lib/brewing/fermenter-availability'

const ferm = (id: string, status = 'empty') => ({ id, name: id, status })
const batch = (fermenterBoardId: string | undefined, status = 'in-progress') => ({
  status,
  fermenterBoardId,
})

describe('availableFermenters', () => {
  it('excludes a locally-empty vessel that a SYNCED in-progress batch occupies (the cross-device bug)', () => {
    // The core case: device B's local fermenter store says f1 is 'empty' (it never
    // started the brew), but a synced in-progress batch sits on f1. f1 must NOT be
    // offered as available.
    const out = availableFermenters([ferm('f1', 'empty'), ferm('f2', 'empty')], [batch('f1')])
    expect(out.map((f) => f.id)).toEqual(['f2'])
  })

  it('includes a locally-empty vessel with no batch on it', () => {
    const out = availableFermenters([ferm('f1'), ferm('f2')], [batch('f2')])
    expect(out.map((f) => f.id)).toEqual(['f1'])
  })

  it('excludes a vessel the local store already marks non-empty', () => {
    const out = availableFermenters([ferm('f1', 'fermenting'), ferm('f2', 'empty')], [])
    expect(out.map((f) => f.id)).toEqual(['f2'])
  })

  it('only in-progress batches occupy — completed/archived do not', () => {
    const out = availableFermenters(
      [ferm('f1'), ferm('f2')],
      [batch('f1', 'complete'), batch('f2', 'archived')],
    )
    expect(out.map((f) => f.id)).toEqual(['f1', 'f2'])
  })

  it('a batch with no fermenterBoardId occupies nothing', () => {
    const out = availableFermenters([ferm('f1')], [batch(undefined)])
    expect(out.map((f) => f.id)).toEqual(['f1'])
  })
})
