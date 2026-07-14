import { type GearCategory, GearCategorySchema, type GearItem } from '@/lib/brewing/types/gear'

/**
 * Human labels for each gear category. Single source of truth shared by the
 * grouped-rows view, the category filter, and the edit form. Pure data (no DOM),
 * so it stays portable alongside the rest of the calc/brewing layer.
 */
export const GEAR_CATEGORY_LABELS: Record<GearCategory, string> = {
  kettle: 'Kettle',
  'mash-tun': 'Mash tun',
  fermenter: 'Fermenter',
  pump: 'Pump',
  instrument: 'Instrument',
  kegging: 'Kegging',
  bottling: 'Bottling',
  cleaning: 'Cleaning',
  storage: 'Storage',
  other: 'Other',
}

/**
 * Canonical display order for category groups — mirrors the schema enum's
 * declaration order so the grouped view is stable regardless of insertion order.
 */
export const GEAR_CATEGORY_ORDER: readonly GearCategory[] = GearCategorySchema.options

export interface GearGroup {
  category: GearCategory
  label: string
  items: GearItem[]
  /** Number of items in this group (== `items.length`). */
  count: number
  /** Sum of `pricePaid_USD` across the group; unpriced items contribute 0. */
  totalValue: number
}

/**
 * Pure aggregator: fold a flat gear list into ordered, per-category groups.
 *
 * - Only categories that actually have items produce a group (no empty sections).
 * - Groups come back in {@link GEAR_CATEGORY_ORDER}; items keep their input order
 *   within a group.
 * - `totalValue` sums `pricePaid_USD`, treating an undefined price as 0.
 *
 * No DOM, no Dexie — unit-testable and portable.
 */
export function groupGearByCategory(items: GearItem[]): GearGroup[] {
  const byCategory = new Map<GearCategory, GearItem[]>()
  for (const item of items) {
    const bucket = byCategory.get(item.category)
    if (bucket) bucket.push(item)
    else byCategory.set(item.category, [item])
  }

  const groups: GearGroup[] = []
  for (const category of GEAR_CATEGORY_ORDER) {
    const groupItems = byCategory.get(category)
    if (!groupItems || groupItems.length === 0) continue
    const totalValue = groupItems.reduce((sum, i) => sum + (i.pricePaid_USD ?? 0), 0)
    groups.push({
      category,
      label: GEAR_CATEGORY_LABELS[category],
      items: groupItems,
      count: groupItems.length,
      totalValue,
    })
  }
  return groups
}
