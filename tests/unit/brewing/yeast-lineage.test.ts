import { describe, expect, it } from 'vitest'
import { buildLineage } from '@/lib/brewing/inventory/yeast-lineage'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const ISO = '2026-07-13T00:00:00.000Z'
function lot(p: Partial<YeastLot> & { id: string }): YeastLot {
  return {
    name: 'WLP001',
    strain: 'California Ale',
    form: 'slurry',
    productionDate: ISO,
    initialCells_B: 100,
    generation: 0,
    quantity: 1,
    unit: 'mL',
    notes_md: '',
    createdAt: ISO,
    updatedAt: ISO,
    schemaVersion: 1,
    ...p,
  }
}
const count = (l: import('@/lib/brewing/inventory/yeast-lineage').StrainLineage) => {
  let n = l.orphanLots.length
  const walk = (node: import('@/lib/brewing/inventory/yeast-lineage').LineageNode) => {
    n++
    node.children.forEach(walk)
  }
  l.roots.forEach(walk)
  return n
}

describe('buildLineage', () => {
  it('builds a parent→child forest and sets depth', () => {
    const [g0, g1] = [
      lot({ id: 'a', generation: 0 }),
      lot({ id: 'b', generation: 1, parentLotId: 'a' }),
    ]
    const [line] = buildLineage([g0, g1])
    expect(line.roots).toHaveLength(1)
    expect(line.roots[0].lot.id).toBe('a')
    expect(line.roots[0].depth).toBe(0)
    expect(line.roots[0].children[0].lot.id).toBe('b')
    expect(line.roots[0].children[0].depth).toBe(1)
  })

  it('surfaces a lot whose parent is missing as an ORPHANED ROOT — subtree intact, not flattened', () => {
    const orphan = lot({ id: 'x', parentLotId: 'ghost' })
    const [line] = buildLineage([orphan])
    expect(line.roots.map((r) => r.lot.id)).toContain('x')
    expect(line.orphanLots.map((l) => l.id)).not.toContain('x')
    const root = line.roots.find((r) => r.lot.id === 'x')
    expect(root?.orphaned).toBe(true)
  })

  it('a genuine root (no parentLotId) is NOT marked orphaned', () => {
    const g0 = lot({ id: 'a' })
    const [line] = buildLineage([g0])
    expect(line.roots[0].orphaned).toBe(false)
  })

  it('a missing-parent lot WITH an in-set child builds the child as its descendant (subtree survives a mid-chain delete)', () => {
    const missingParentRoot = lot({ id: 'b', generation: 1, parentLotId: 'ghost-a' })
    const child = lot({ id: 'c', generation: 2, parentLotId: 'b' })
    const [line] = buildLineage([missingParentRoot, child])
    expect(line.orphanLots).toHaveLength(0)
    expect(line.roots).toHaveLength(1)
    const root = line.roots[0]
    expect(root.lot.id).toBe('b')
    expect(root.orphaned).toBe(true)
    expect(root.children).toHaveLength(1)
    expect(root.children[0].lot.id).toBe('c')
    expect(root.children[0].orphaned).toBe(false)
  })

  it('NEVER drops a lot in a pure cycle (count conservation)', () => {
    const a = lot({ id: 'a', parentLotId: 'b' })
    const b = lot({ id: 'b', parentLotId: 'a' })
    const [line] = buildLineage([a, b])
    expect(count(line)).toBe(2) // both accounted for — as orphans, since neither is a root
  })

  it('conserves count across a mixed forest', () => {
    const lots = [
      lot({ id: 'a' }),
      lot({ id: 'b', parentLotId: 'a' }),
      lot({ id: 'c', parentLotId: 'a' }),
      lot({ id: 'd', parentLotId: 'ghost' }),
    ]
    const [line] = buildLineage(lots)
    expect(count(line)).toBe(4)
  })

  it('groups by strain case-insensitively', () => {
    const lots = [
      lot({ id: 'a', strain: 'California Ale' }),
      lot({ id: 'b', strain: 'california ale' }),
      lot({ id: 'c', strain: 'Hefeweizen' }),
    ]
    expect(buildLineage(lots)).toHaveLength(2)
  })
})
