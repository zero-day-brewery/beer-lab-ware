/**
 * Example gear — generic instruments and small tools, logged by physical
 * count. Not real purchase data; replace with your own inventory.
 */
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const MISC_GEAR: readonly GearItem[] = [
  {
    id: 'c0ffee00-0001-4000-8000-000000000001',
    name: 'Chrome Draft Beer Faucet',
    category: 'kegging',
    condition: 'good',
    location: 'Garage / kegging area',
    notes_md: 'Standard chrome-plated lever draft faucet.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'c0ffee00-0001-4000-8000-000000000002',
    name: 'pH / Temperature Meter',
    category: 'instrument',
    condition: 'new',
    location: 'Garage / brewing station',
    notes_md: 'Bench/portable pH + temperature meter for mash pH and water chemistry.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'c0ffee00-0001-4000-8000-000000000003',
    name: 'Digital Kitchen Scale',
    category: 'instrument',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Digital scale for weighing grain, hops, and water-treatment salts.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'c0ffee00-0001-4000-8000-000000000004',
    name: 'CO2 Regulator (Dual Gauge)',
    category: 'kegging',
    condition: 'good',
    location: 'Garage / kegging area',
    notes_md: 'Dual-gauge primary CO2 regulator — tank pressure + serving PSI.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
