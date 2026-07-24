import { describe, expect, it } from 'vitest'
import { reparentCandidates } from '@/lib/brewing/inventory/yeast-reparent'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const lot = (id: string, strain: string, parentLotId?: string) =>
  ({ id, name: id, strain, parentLotId, generation: 0 }) as unknown as YeastLot

describe('reparentCandidates', () => {
  it('offers only same-strain lots (different strains excluded)', () => {
    const target = lot('t', 'Cali Ale')
    const all = [target, lot('a', 'Cali Ale'), lot('x', 'Hefe')]
    expect(reparentCandidates(target, all).map((l) => l.id)).toEqual(['a'])
  })

  it('excludes the lot itself', () => {
    const target = lot('t', 'S')
    expect(reparentCandidates(target, [target]).map((l) => l.id)).toEqual([])
  })

  it('excludes a DIRECT child (would create a 1-cycle)', () => {
    const target = lot('t', 'S')
    const child = lot('c', 'S', 't')
    const sibling = lot('sib', 'S')
    expect(reparentCandidates(target, [target, child, sibling]).map((l) => l.id)).toEqual(['sib'])
  })

  it('excludes a TRANSITIVE descendant (grandchild) too', () => {
    const target = lot('t', 'S')
    const child = lot('c', 'S', 't')
    const grandchild = lot('g', 'S', 'c')
    const ok = lot('ok', 'S')
    const out = reparentCandidates(target, [target, child, grandchild, ok]).map((l) => l.id)
    expect(out).toEqual(['ok'])
  })

  it('offers a sibling / unrelated same-strain lot as valid', () => {
    const target = lot('t', 'S', 'p') // t's parent p was deleted (orphan)
    const p = lot('p2', 'S') // a different existing lot, valid new parent
    expect(reparentCandidates(target, [target, p]).map((l) => l.id)).toEqual(['p2'])
  })

  it('normalizes strain (trim + case) like buildLineage', () => {
    const target = lot('t', 'Cali Ale')
    const a = lot('a', '  cali ale ')
    expect(reparentCandidates(target, [target, a]).map((l) => l.id)).toEqual(['a'])
  })

  it('does not infinite-loop on a REACHABLE data cycle (mutual parents)', () => {
    // Corrupt data: t and c are each other's parent. Walking t's descendants
    // reaches c (and loops back to t); the visited set must terminate it, and c
    // is (via the cycle) a descendant → excluded.
    const target = lot('t', 'S', 'c')
    const c = lot('c', 'S', 't')
    const out = reparentCandidates(target, [target, c]).map((l) => l.id)
    expect(out).toEqual([])
  })
})
