process.env.TZ = 'UTC'

import 'fake-indexeddb/auto'

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')

  // Vitest 4 + Node 25: global.localStorage is a Node.js 25 experimental stub
  // (no .clear/.setItem/.getItem methods). The real Storage is on the jsdom
  // window stored at global.jsdom. Bridge both localStorage + sessionStorage
  // so tests can call the standard Web Storage API.
  const jsdomWin = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window
  if (jsdomWin) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: jsdomWin.localStorage,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: jsdomWin.sessionStorage,
      writable: true,
      configurable: true,
    })
  }
}
