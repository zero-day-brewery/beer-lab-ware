'use client'
import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { BrewTimer } from '@/lib/brewing/types/timer'
import { useTimerStore } from '@/stores/timer-store'

/** Synthesized beep — no audio asset, works offline. */
function beep(): void {
  if (typeof window === 'undefined') return
  if (!('AudioContext' in window) && !('webkitAudioContext' in window)) return
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    /* audio unavailable — toast + visual still fire */
  }
}

function notify(label: string): void {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification('Brew timer', { body: label })
  }
}

function remaining(fireAt: string): string {
  const ms = new Date(fireAt).getTime() - Date.now()
  if (ms <= 0) return '00:00'
  const s = Math.round(ms / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function TimerRack(): JSX.Element {
  const { timers, missedOnLoad } = useTimerStore()
  const seen = useRef<Set<string>>(new Set())
  // Drive a local per-second re-render so `remaining(t.fireAt)` recomputes every
  // second independent of store mutations (the store tick only fires on timer
  // state changes, not every second between firings).
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Catch-up notice for timers that fired while the tab was closed.
  useEffect(() => {
    for (const t of missedOnLoad) {
      if (seen.current.has(t.id)) continue
      seen.current.add(t.id)
      toast(`${t.label} — fired while away`)
    }
  }, [missedOnLoad])

  // Fire on transition into 'fired' (beep + toast + notification once per timer).
  useEffect(() => {
    for (const t of timers) {
      if (t.status === 'fired' && !seen.current.has(t.id)) {
        seen.current.add(t.id)
        beep()
        toast(t.label, { description: 'Timer done' })
        notify(t.label)
      }
    }
  }, [timers])

  // Opt-in Web Notifications: request permission once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  const visible: BrewTimer[] = timers.filter((t) => t.status !== 'cancelled' && !t.parentId)

  return (
    <div className="tmr-rack">
      {visible.map((t) => (
        <div
          key={t.id}
          className={`tmr-card ${t.status === 'fired' ? 'tmr-fired' : 'tmr-armed'} ${
            t.status === 'fired' ? 'tmr-pulse' : ''
          }`}
        >
          <span>{t.label}</span>
          <span className="tmr-countdown">
            {t.status === 'fired' ? 'done' : remaining(t.fireAt)}
          </span>
        </div>
      ))}
    </div>
  )
}
