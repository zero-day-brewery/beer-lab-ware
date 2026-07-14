'use client'
import { useCallback } from 'react'

/** Optional step readout. Default ON on brew day; caller passes `enabled`. No-ops if unsupported. */
export function useSpeech(enabled: boolean): { speak: (text: string) => void; supported: boolean } {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const speak = useCallback(
    (text: string) => {
      if (!enabled || !supported || !text) return
      try {
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 0.95
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(u)
      } catch {
        /* unsupported voice engine — silent */
      }
    },
    [enabled, supported],
  )
  return { speak, supported }
}
