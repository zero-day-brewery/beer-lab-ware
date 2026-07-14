/**
 * Example gear — a generic ball-lock keg inventory.
 * Not real purchase data; replace with your own inventory.
 */
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const HOMEBREWING_GEAR: readonly GearItem[] = [
  {
    id: '01da1e00-0001-4000-8000-000000000001',
    name: '1.75 Gallon Ball Lock Keg (× 2)',
    category: 'kegging',
    condition: 'good',
    location: 'Garage / kegging area',
    notes_md: 'Small-format ball lock kegs — good for pilot batches.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: '01da1e00-0001-4000-8000-000000000002',
    name: '5 Gallon Ball Lock Keg (× 4)',
    category: 'kegging',
    condition: 'good',
    location: 'Garage / kegging area',
    notes_md: 'Cornelius-style ball lock kegs — primary serving kegs.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
