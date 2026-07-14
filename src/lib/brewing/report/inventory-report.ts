import type { GearCategory, GearItem } from '@/lib/brewing/types/gear'
import {
  type InventoryItem,
  type InventoryKind,
  isLowStock,
  isPastBestBy,
} from '@/lib/brewing/types/inventory'

export interface ReportGroup<T> {
  key: string
  label: string
  items: T[]
  count: number
}

export interface GearSection {
  groups: ReportGroup<GearItem>[]
  totalCount: number
}

export interface IngredientSection {
  groups: ReportGroup<InventoryItem>[]
  totalCount: number
  lowStockCount: number
  pastBestByCount: number
}

export interface InventoryReport {
  generatedAtISO: string
  title: string
  subtitle: string
  gear: GearSection
  ingredients: IngredientSection
}

export interface BuildReportInput {
  gear: GearItem[]
  inventory: InventoryItem[]
  generatedAt: Date
}

const GEAR_ORDER: GearCategory[] = [
  'kettle',
  'mash-tun',
  'fermenter',
  'pump',
  'instrument',
  'kegging',
  'bottling',
  'cleaning',
  'storage',
  'other',
]

const KIND_ORDER: InventoryKind[] = [
  'fermentable',
  'hop',
  'yeast',
  'misc',
  'water-treatment',
  'other',
]

const GEAR_LABELS: Record<GearCategory, string> = {
  kettle: 'Kettles',
  'mash-tun': 'Mash Tuns',
  fermenter: 'Fermenters',
  pump: 'Pumps',
  instrument: 'Instruments',
  kegging: 'Kegging',
  bottling: 'Bottling',
  cleaning: 'Cleaning',
  storage: 'Storage',
  other: 'Other',
}

const KIND_LABELS: Record<InventoryKind, string> = {
  fermentable: 'Fermentables',
  hop: 'Hops',
  yeast: 'Yeast',
  misc: 'Misc',
  'water-treatment': 'Water Treatment',
  other: 'Other',
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

function groupBy<T extends { name: string }, K extends string>(
  items: T[],
  order: K[],
  keyOf: (item: T) => K,
  labelOf: (key: K) => string,
): ReportGroup<T>[] {
  return order
    .map((key) => {
      const groupItems = items.filter((i) => keyOf(i) === key).sort(byName)
      return { key, label: labelOf(key), items: groupItems, count: groupItems.length }
    })
    .filter((g) => g.count > 0)
}

export function buildInventoryReport(input: BuildReportInput): InventoryReport {
  const { gear, inventory, generatedAt } = input

  const gearGroups = groupBy(
    gear,
    GEAR_ORDER,
    (i) => i.category,
    (k) => GEAR_LABELS[k],
  )
  const ingredientGroups = groupBy(
    inventory,
    KIND_ORDER,
    (i) => i.ingredientKind,
    (k) => KIND_LABELS[k],
  )

  return {
    generatedAtISO: generatedAt.toISOString(),
    title: 'Beer-Lab-Ware',
    subtitle: 'Inventory Report',
    gear: { groups: gearGroups, totalCount: gear.length },
    ingredients: {
      groups: ingredientGroups,
      totalCount: inventory.length,
      lowStockCount: inventory.filter(isLowStock).length,
      pastBestByCount: inventory.filter((i) => isPastBestBy(i, generatedAt)).length,
    },
  }
}
