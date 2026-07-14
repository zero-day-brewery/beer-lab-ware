import { beforeEach, describe, expect, it } from 'vitest'
import { useSystemStore } from '@/stores/system-store'

// startBrew/stopBrew now drive every brew system's status (array model).
const brewOn = () => useSystemStore.getState().brewSystems.some((b) => b.status === 'active')

describe('system-store brew session', () => {
  beforeEach(() => useSystemStore.getState().stopBrew())
  it('startBrew sets the Brew System active and records the session', () => {
    useSystemStore.getState().startBrew({
      recipeName: 'Test IPA',
      sourceProfileName: 'RO / Distilled',
      additionsSummary: 'gypsum 6 g',
    })
    expect(brewOn()).toBe(true)
    expect(useSystemStore.getState().currentBrew?.recipeName).toBe('Test IPA')
  })
  it('stopBrew clears the session and deactivates', () => {
    useSystemStore.getState().startBrew({ skipped: true })
    useSystemStore.getState().stopBrew()
    expect(brewOn()).toBe(false)
    expect(useSystemStore.getState().currentBrew).toBeNull()
  })
})
