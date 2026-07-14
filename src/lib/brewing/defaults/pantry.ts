/**
 * Example pantry / consumables inventory (InventoryItem rows). A small,
 * generic starter set — not real purchase data.
 */
import type { InventoryItem } from '@/lib/brewing/types/inventory'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

export const PANTRY_INVENTORY: readonly InventoryItem[] = [
  {
    id: 'd1e70000-0001-4000-8000-000000000001',
    name: 'Pale Ale Malt (2-Row)',
    ingredientKind: 'fermentable',
    amount: 10,
    amountUnit: 'lb',
    storageLocation: 'Pantry / grain shelf',
    status: 'sealed',
    notes_md: 'Base malt for general-purpose ale recipes.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'd1e70000-0001-4000-8000-000000000002',
    name: 'Cascade Hops (Pellet)',
    ingredientKind: 'hop',
    amount: 4,
    amountUnit: 'oz',
    storageLocation: 'Freezer / hop bags',
    status: 'sealed',
    notes_md: 'General-purpose American aroma hop.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'd1e70000-0001-4000-8000-000000000003',
    name: 'US-05 Ale Yeast',
    ingredientKind: 'yeast',
    amount: 2,
    amountUnit: 'packets',
    storageLocation: 'Fridge / yeast shelf',
    status: 'sealed',
    notes_md: 'Clean American ale yeast strain.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'd1e70000-0001-4000-8000-000000000004',
    name: 'Gypsum (Calcium Sulfate)',
    ingredientKind: 'water-treatment',
    amount: 8,
    amountUnit: 'oz',
    storageLocation: 'Pantry / brewing salts shelf',
    status: 'opened',
    notes_md: 'Brewing water salt — adds calcium and sulfate.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
