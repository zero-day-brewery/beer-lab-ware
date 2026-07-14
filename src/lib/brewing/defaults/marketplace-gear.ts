/**
 * Example gear — generic starter items from a general online marketplace.
 * Not real purchase data; replace with your own inventory.
 */
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const MARKETPLACE_GEAR: readonly GearItem[] = [
  {
    id: 'a4202000-0001-4000-8000-000000000001',
    name: 'Stainless Steel Brew Kettle (5 gal)',
    category: 'kettle',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Backup kettle for small-batch or partigyle brews.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'a4202000-0001-4000-8000-000000000002',
    name: '1-Gallon Glass Fermenter with Airlock',
    category: 'fermenter',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Small test-batch glass carboy with stopper and airlock.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'a4202000-0001-4000-8000-000000000003',
    name: 'Digital Temperature Controller (2-Stage)',
    category: 'instrument',
    condition: 'good',
    location: 'Garage / fermentation area',
    notes_md: 'Drives fermenter heating + cooling for temperature control.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'a4202000-0001-4000-8000-000000000004',
    name: 'Triple-Scale Hydrometer + Test Jar',
    category: 'instrument',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Specific gravity / ABV testing kit with hardcase and test jar.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
