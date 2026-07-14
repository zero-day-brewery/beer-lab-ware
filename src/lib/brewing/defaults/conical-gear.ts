/**
 * Example gear — a generic jacketed conical fermenter setup.
 * Not real purchase data; replace with your own inventory.
 */
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const CONICAL_GEAR: readonly GearItem[] = [
  {
    id: '5b1ce000-0001-4000-8000-000000000001',
    name: 'Jacketed Conical Fermenter (× 2)',
    category: 'fermenter',
    condition: 'good',
    location: 'Garage / fermentation area',
    notes_md: 'Glycol-jacketed conical fermenters, capacity-flexible.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: '5b1ce000-0001-4000-8000-000000000003',
    name: 'CO2 Gas Manifold (× 2)',
    category: 'kegging',
    condition: 'good',
    location: 'Garage / kegging area',
    notes_md: 'CO2 distribution manifold for serving / fermentation.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: '5b1ce000-0001-4000-8000-000000000004',
    name: 'Tri-Clamp Sample Valve (× 2)',
    category: 'other',
    condition: 'good',
    location: 'Garage / fermentation area',
    notes_md: 'Sanitary sample valve for pulling gravity/tasting samples.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
