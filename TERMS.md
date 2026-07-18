# Terms of Use

Beer-Lab-Ware is open-source software provided under the [MIT License](./LICENSE).
These terms restate and add plain-language context to the MIT disclaimer; the MIT
License governs.

## No warranty

The software is provided **"as is", without warranty of any kind**. The maintainers
make no guarantee that any calculation, chart, recommendation, or piece of stored
data is accurate, complete, or fit for any purpose.

## Brewing calculations are estimates

All calculators in this app — gravity, ABV, IBU, SRM, water chemistry, yeast
viability and pitch rates, carbonation, and everything else — produce **estimates**
based on published models. Real-world results vary with equipment, ingredients,
process, and measurement error. Cross-check anything that matters.

## Safety-critical outputs

Some outputs relate to **pressurized vessels** (force carbonation, spunding
setpoints, line balancing, bottle conditioning). Treat these as guidance only:

- **Always verify pressures against the rated MAWP (maximum allowable working
  pressure) and the manufacturer's documentation** for your specific keg,
  fermenter, valve, and tubing.
- Never rely on a calculator output as the sole safeguard against
  over-pressurization. Over-pressurized vessels and bottles can rupture and
  cause serious injury.
- Inspect equipment for damage and use pressure-relief hardware as the
  manufacturer directs.

You assume all risk arising from applying any value this software produces.

## Not professional advice

Nothing in this software is engineering, legal, tax, or regulatory advice. If you
brew commercially, **you** are responsible for compliance with the laws that apply
to you (for example TTB and state/local requirements in the US, or your local
equivalents), including record-keeping, labeling, and taxation.

## Your data is yours — and your responsibility

By default all data lives in your browser's local storage and is never sent to any
server operated by this project. Browsers can and do evict local data. **Take
regular backups** (the app's backup/export tools exist for exactly this). The
maintainers are not responsible for data loss.

## AI companion

The optional AI companion sends the data you ask about to the AI provider **you**
configure, under that provider's terms. See [`PRIVACY.md`](./PRIVACY.md).

## Self-hosted services

If you run the optional sync daemon (or any other component) on your own
infrastructure, you are the operator: securing it, backing it up, and complying
with whatever obligations apply to it are yours.

---

*This document is provided for clarity and is not legal advice. If you distribute
or commercialize this software, have your own counsel review your obligations.*
