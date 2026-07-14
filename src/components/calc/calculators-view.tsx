'use client'
import { AbvCard } from './calculators/abv-card'
import { CarbonationCard } from './calculators/carbonation-card'
import { GravityConvertCard } from './calculators/gravity-convert-card'
import { PitchRateCard } from './calculators/pitch-rate-card'
import { RefractometerCard } from './calculators/refractometer-card'
import { StrikeTempCard } from './calculators/strike-temp-card'

/**
 * The /calculators page: a responsive grid of self-contained, live-computing
 * calculator cards. Each card wraps an already-tested `src/lib/brewing` engine —
 * no new brewing math lives here. Matches the gear/system page-shell heading.
 */
export function CalculatorsView() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-border/70 pb-6">
        <span className="eyebrow">🧮 Calculators</span>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Calculators</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Quick brew-day math — pitch rate, carbonation, refractometer FG, gravity units, ABV, and
          strike water. Every field recomputes live; nothing leaves your machine.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <PitchRateCard />
        <CarbonationCard />
        <RefractometerCard />
        <GravityConvertCard />
        <AbvCard />
        <StrikeTempCard />
      </div>
    </div>
  )
}
