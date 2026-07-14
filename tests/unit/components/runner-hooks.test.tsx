// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAlarm } from '@/hooks/use-alarm'
import { useSpeech } from '@/hooks/use-speech'
import { useWakeLock } from '@/hooks/use-wake-lock'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useWakeLock', () => {
  it('reports unsupported and never throws when navigator.wakeLock is absent', () => {
    const { result } = renderHook(() => useWakeLock(true))
    expect(result.current.supported).toBe(false)
  })

  it('requests a sentinel when supported and active', async () => {
    const request = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) })
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } })
    const { result } = renderHook(() => useWakeLock(true))
    expect(result.current.supported).toBe(true)
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
  })
})

describe('useAlarm', () => {
  it('reports no audio/vibrate support in jsdom and fire() is a no-op (no throw)', () => {
    const { result } = renderHook(() => useAlarm())
    expect(result.current.supported.audio).toBe(false)
    expect(result.current.supported.vibrate).toBe(false)
    expect(() => result.current.fire()).not.toThrow()
  })

  it('vibrates when navigator.vibrate exists', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    const { result } = renderHook(() => useAlarm())
    expect(result.current.supported.vibrate).toBe(true)
    result.current.fire()
    expect(vibrate).toHaveBeenCalled()
  })
})

describe('useSpeech', () => {
  it('reports unsupported and speak() is a no-op when speechSynthesis is absent', () => {
    const { result } = renderHook(() => useSpeech(true))
    expect(result.current.supported).toBe(false)
    expect(() => result.current.speak('Ramp to boil')).not.toThrow()
  })

  it('does not speak when disabled even if supported', () => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text = ''
        constructor(t: string) {
          this.text = t
        }
      },
    )
    const { result } = renderHook(() => useSpeech(false))
    result.current.speak('Ramp to boil')
    expect(speak).not.toHaveBeenCalled()
  })
})
