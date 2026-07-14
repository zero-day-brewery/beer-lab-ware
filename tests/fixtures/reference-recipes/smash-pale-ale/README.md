# SMaSH Pale Ale — synthetic fixture

Hand-computed reference fixture. Replace `expected.json` with real measured
output values when a brewer makes a SMaSH on the B40 Pro.

## Hand-calc summary

- 4.5 kg 2-Row Pale @ 72% brewhouse efficiency:
  - OG = (4.5 × 2.20462 × 37 × 0.72) / 5.020 / 1000 + 1 ≈ **1.053**
- FG with US-05 at 78.5% atten = 1.053 - 0.053×0.785 ≈ **1.011**
- ABV (simple) = (1.053-1.011) × 131.25 ≈ **5.4%**
- IBU (Tinseth, canonical): 3 × 28g Cascade @ 5.5% × U(60/15/5, avg-boil-gravity)
  over the **post-boil volume** (20.83 L), not the 19 L into-fermenter volume.
  Base (whole-hop) ≈ 29.1; the Cascade additions are **pellet**, so the ×1.10
  hop-form utilization factor (see `src/lib/brewing/calc/hop-form.ts`) lifts this
  to ≈ **32.0**. (Base math independently validated by the published golden
  masters in golden-master.test.ts, which use whole/leaf so form factor = 1.0.)
- SRM (Morey): MCU 3.95 → 1.4922 × 3.95^0.6859 ≈ **3.8**
- Volumes: intoFermenter 19, postBoil 20.83, preBoil 23.83
- Strike: (0.41/2.6) × (66-20) + 66 ≈ **73.3°C**
