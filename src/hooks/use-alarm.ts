'use client'
import { useCallback, useMemo } from 'react'

export interface AlarmApi {
  fire: () => void
  supported: { audio: boolean; vibrate: boolean }
}

type AudioCtor = typeof AudioContext
function getAudioCtor(): AudioCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext
}

/** Synthesized beep + photosensitivity-safe vibrate. Visual gs-flash is owned by the caller. */
export function useAlarm(): AlarmApi {
  const audioCtor = getAudioCtor()
  const hasVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  const supported = useMemo(
    () => ({ audio: !!audioCtor, vibrate: hasVibrate }),
    [audioCtor, hasVibrate],
  )
  const fire = useCallback(() => {
    if (audioCtor) {
      try {
        const ctx = new audioCtor()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 880
        gain.gain.value = 0.18
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.4)
        osc.onended = () => void ctx.close().catch(() => {})
      } catch {
        /* autoplay policy — silent */
      }
    }
    if (hasVibrate) navigator.vibrate([200, 100, 200])
  }, [audioCtor, hasVibrate])
  return { fire, supported }
}
