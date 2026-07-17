// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StrikeTempCard } from '@/components/calc/calculators/strike-temp-card'
import { formatWithUnit, fromDisplay } from '@/lib/brewing/convert/display-units'
import { calcStrikeTemp } from '@/lib/brewing/mash/strike'
import type { Settings } from '@/lib/brewing/types/settings'
import { db } from '@/lib/db/schema'

const IMPERIAL: Settings = {
  id: 'global',
  units: 'imperial',
  defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  theme: 'default',
  schemaVersion: 1,
}

describe('StrikeTempCard — imperial display units', () => {
  beforeEach(async () => {
    await db.settings.put(IMPERIAL)
  })
  afterEach(async () => {
    await db.settings.clear()
  })

  it('labels inputs in °F + qt/lb, seeds converted defaults, and outputs °F with a °C echo', async () => {
    render(<StrikeTempCard />)

    // Labels flip to imperial once settings resolve.
    expect(await screen.findByText('Mash target °F')).toBeInTheDocument()
    expect(screen.getByText('Grain °F')).toBeInTheDocument()
    expect(screen.getByText('Ratio qt/lb')).toBeInTheDocument()

    // Defaults: 67 °C → 152.6 °F, 20 °C → 68 °F, 2.6 L/kg → 1.25 qt/lb.
    expect(screen.getByLabelText('Mash target °F')).toHaveValue(152.6)
    expect(screen.getByLabelText('Grain °F')).toHaveValue(68)
    expect(screen.getByLabelText('Ratio qt/lb')).toHaveValue(1.25)

    // The engine runs on the parsed CANONICAL values (°C + L/kg); the output
    // shows °F with the metric echo in the hint.
    const expectedC = calcStrikeTemp(
      fromDisplay(152.6, 'temp', 'imperial'),
      fromDisplay(68, 'temp', 'imperial'),
      fromDisplay(1.25, 'mash-ratio', 'imperial'),
    )
    expect(screen.getByText(formatWithUnit(expectedC, 'temp', 'imperial', 1))).toBeInTheDocument()
    expect(screen.getByText(formatWithUnit(expectedC, 'temp', 'metric', 1))).toBeInTheDocument()
  })
})
