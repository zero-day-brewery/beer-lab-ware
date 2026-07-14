/**
 * Example all-in-one brewing system defaults + accessory inventory.
 *
 * EquipmentProfile values are sane factory-style starting defaults for a
 * single-vessel 40 L RIMS system (3.2 kW, ~9 kg max grist). Not measured
 * truth — recalibrate after your first brew day.
 */
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { GearItem } from '@/lib/brewing/types/gear'

const SEED_STAMP = '2024-01-01T00:00:00.000Z'

/** Stable UUID — matches the placeholder ID previously hardcoded in calc panels. */
export const B40PRO_PROFILE_ID = '550e8400-e29b-41d4-a716-446655440010'

export const B40PRO_PROFILE: EquipmentProfile = {
  id: B40PRO_PROFILE_ID,
  name: 'B40pro (US110V)',
  isDefault: true,

  // Single-vessel design: kettle == mash tun (BIAB-style integrated basket)
  mashTunVolume_L: 40,
  mashTunDeadSpace_L: 0.5,
  kettleVolume_L: 40,
  kettleDeadSpace_L: 2.0, // trub filter sits below the false bottom

  // Fermenter sized generically; 30 L is the common paired size
  fermenterVolume_L: 30,
  fermenterDeadSpace_L: 0.5,

  // Process — steam-condensing lid installed, which slashes evaporation vs. open boil
  evaporationRate_LperHr: 1.0,
  coolingShrinkage_pct: 4,
  topUpKettle_L: 0,
  topUpWater_L: 0,
  grainAbsorption_LperKg: 1.0,

  // Efficiency — RIMS recirculation + sparge manifold helps; conservative until calibrated
  mashEfficiency_pct: 78,
  brewhouseEfficiency_pct: 72,

  ibuFormula: 'tinseth',
  srmFormula: 'morey',
  abvFormula: 'simple',
  hopUtilizationMultiplier: 1,

  calibrationNotes_md: [
    '## Single-vessel RIMS system, 3.2 kW, ~9 kg max grist',
    '',
    'Installed accessories (affect these defaults):',
    '- **Steam-condensing lid** — drops boil-off to ~1 L/hr (vs ~3–4 L/hr open boil)',
    '- **Insulation jacket** — holds mash temp during the 60 min rest',
    '- **Trub filter** — sits below the false bottom, keeps hot break out of the fermenter',
    '- **Sparge manifold** — improves lautering uniformity',
    '',
    '> Factory-style starting defaults — recalibrate after your first brew day.',
    '> Measure actual: evaporation rate, grain absorption, mash & brewhouse efficiency.',
  ].join('\n'),

  schemaVersion: 1,
}

/**
 * Example accessory inventory for the brewing system above.
 * IDs are stable so re-running the seed is idempotent.
 */
export const B40PRO_GEAR: readonly GearItem[] = [
  {
    id: 'b40e1000-0001-4000-8000-000000000001',
    name: 'All-in-One Brewing System (40 L)',
    category: 'kettle',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Single-vessel RIMS — kettle + mash basket + integrated pump. Main brewing system.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'b40e1000-0001-4000-8000-000000000002',
    name: 'Steam-Condensing Lid',
    category: 'other',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Lid with silicone plug and seal — captures evaporation, drops boil-off to ~1 L/hr.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
  {
    id: 'b40e1000-0001-4000-8000-000000000003',
    name: 'Insulation Jacket',
    category: 'other',
    condition: 'good',
    location: 'Garage / brewing station',
    notes_md: 'Wrap-around insulation — holds mash temp during the 60 min rest.',
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
    schemaVersion: 1,
  },
] as const
