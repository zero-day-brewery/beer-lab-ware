/**
 * The full guided brew manual as pure data. One ProcessManual, five stages.
 * MANUAL_VERSION is pinned into each BrewSession at start (no mid-ferment migrate).
 * PURE: no DOM/Dexie/fetch/store imports.
 */
import { PREP_STAGE } from './manual.stages/00-prep'
import { HOTSIDE_STAGE } from './manual.stages/01-hotside'
import { FERMENTATION_STAGE } from './manual.stages/02-fermentation'
import { PACKAGING_STAGE } from './manual.stages/03-packaging'
import { CONDITIONING_STAGE } from './manual.stages/04-conditioning'
import type { ProcessManual } from './types'

export const MANUAL_VERSION = 1

export const BREW_MANUAL: ProcessManual = {
  version: MANUAL_VERSION,
  stages: [PREP_STAGE, HOTSIDE_STAGE, FERMENTATION_STAGE, PACKAGING_STAGE, CONDITIONING_STAGE],
}

export { CONDITIONING_STAGE, FERMENTATION_STAGE, HOTSIDE_STAGE, PACKAGING_STAGE, PREP_STAGE }
