import type { Water } from '@/lib/brewing/types/ingredient'

const w = (
  id: string,
  name: string,
  Ca: number,
  Mg: number,
  Na: number,
  SO4: number,
  Cl: number,
  HCO3: number,
): Water => ({
  id,
  kind: 'water',
  name,
  Ca_ppm: Ca,
  Mg_ppm: Mg,
  Na_ppm: Na,
  SO4_ppm: SO4,
  Cl_ppm: Cl,
  HCO3_ppm: HCO3,
})

/** Source-water presets. Fixed UUIDs so the tombstoned seeder never resurrects a
 *  deleted one. City profiles: Palmer "Water" / classic brewing-water tables. */
export const WATER_PROFILES: readonly Water[] = [
  w('7a7e0001-0000-4000-8000-000000000001', 'RO / Distilled', 0, 0, 0, 0, 0, 0),
  w('7a7e0001-0000-4000-8000-000000000002', 'Soft / Low-mineral', 25, 5, 10, 25, 20, 30),
  w('7a7e0001-0000-4000-8000-000000000003', 'Moderate / Balanced', 60, 8, 20, 60, 50, 80),
  w('7a7e0001-0000-4000-8000-000000000004', 'Pilsen (very soft)', 7, 2, 2, 5, 5, 15),
  w('7a7e0001-0000-4000-8000-000000000005', 'Burton-on-Trent (sulfate)', 275, 40, 25, 610, 35, 270),
  w('7a7e0001-0000-4000-8000-000000000006', 'Dublin (alkaline)', 118, 4, 12, 55, 19, 280),
  w('7a7e0001-0000-4000-8000-000000000007', 'London', 100, 4, 15, 80, 60, 165),
]
