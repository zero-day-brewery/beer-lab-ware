/**
 * Example gear — a generic grain mill entry.
 * Not real purchase data; replace with your own inventory.
 */
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const SUPPLIES_GEAR: readonly GearItem[] = [
  {
    id: 'b6e30000-0001-4000-8000-000000000001',
    name: '3-Roller Grain Mill with Base',
    category: 'other',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Adjustable grain mill — crushes malt to the right husk/grist ratio.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'b6e30000-0001-4000-8000-000000000002',
    name: 'Mill Hopper Extension',
    category: 'other',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Extra-capacity hopper attachment for the grain mill.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
