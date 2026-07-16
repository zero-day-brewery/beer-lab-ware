'use client'
import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (!navigator.serviceWorker) return

    // The service worker is a production PWA concern. In development its
    // cache-first strategy for /_next/static/* pins stale dev chunks, which
    // manifests as broken CSS/JS that survives reloads (the "lost its flair"
    // regression). So: never register it in dev, and actively unregister any
    // that a previous dev session already installed + drop its caches.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister()
      })
      if (typeof caches !== 'undefined') {
        caches.keys().then((keys) => {
          for (const key of keys) caches.delete(key)
        })
      }
      return
    }

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
    navigator.serviceWorker.register(`${base}/sw.js`).catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  }, [])

  return null
}
