import { beforeEach, describe, expect, it } from 'vitest'
import { BREW_MANUAL } from '@/lib/brewing/process/manual'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { ProcessStep } from '@/lib/brewing/process/types'
import { projectStepEffects } from '@/stores/session-store'
import { useSystemStore } from '@/stores/system-store'

const st = () => useSystemStore.getState()
const brewOn = () => st().brewSystems.some((b) => b.status === 'active')
const allSteps = (): ProcessStep[] => BREW_MANUAL.stages.flatMap((s) => s.steps)

beforeEach(() => {
  st().stopBrew()
  st().reset()
})

function sessionFixture(): BrewSession {
  return { recipeName: 'Wire Test Ale', water: { skipped: true } } as unknown as BrewSession
}

describe('projectStepEffects', () => {
  it('applies a step that carries a startSession enterEffect to the board', () => {
    const step = allSteps().find((s) => s.enterEffects?.some((e) => e.t === 'startSession'))
    expect(step, 'manual must contain a step with a startSession enterEffect').toBeDefined()
    projectStepEffects(sessionFixture(), step as ProcessStep, 'enter')
    expect(brewOn()).toBe(true)
    expect(st().currentBrew?.recipeName).toBe('Wire Test Ale')
  })

  it('is a no-op for a step with no effects of the requested phase', () => {
    const plain = allSteps().find(
      (s) => (s.enterEffects?.length ?? 0) === 0 && (s.completeEffects?.length ?? 0) === 0,
    )
    expect(plain, 'manual must contain at least one effect-free step').toBeDefined()
    const before = brewOn()
    projectStepEffects(sessionFixture(), plain as ProcessStep, 'enter')
    expect(brewOn()).toBe(before)
    expect(st().currentBrew).toBeNull()
  })
})
