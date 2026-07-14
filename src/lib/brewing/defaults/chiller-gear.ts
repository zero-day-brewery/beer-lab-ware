/**
 * Example gear — a generic glycol chiller for fermentation temperature
 * control. Not real purchase data; replace with your own inventory.
 */
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const CHILLER_GEAR: readonly GearItem[] = [
  {
    id: 'b8e89c00-0001-4000-8000-000000000001',
    name: 'Glycol Chiller (1/3 HP)',
    category: 'pump',
    condition: 'good',
    location: 'Garage / fermentation area',
    notes_md: [
      'Glycol chiller for fermentation temperature control — drives cold',
      'glycol through jacket coils on conical fermenters.',
      '',
      '## Specs',
      '- 1/3 HP compressor',
      '- ~2,000 BTU/hr cooling capacity',
      '- Built-in reservoir',
    ].join('\n'),
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'b8e89c00-0001-4000-8000-000000000002',
    name: 'Glycol Circulation Pump — Spare',
    category: 'pump',
    condition: 'new',
    location: 'Spares bin',
    notes_md: 'Spare circulation pump for the glycol chiller loop.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
