export interface LocalStateSnapshot {
  keys: Record<string, string>
  capturedAt: string
}

// EXACTLY ONE key — the fermenter board, the real durability gap. Theme is
// cosmetic; brew-companion may hold a plaintext API key (secret-exposure);
// the pointer stores (brew-active-batch/brew-session) dangle on cross-device
// import and self-heal. See spec §E1.4.
const TRACKED = ['brew-system-flow'] as const

export function captureLocalSnapshot(): LocalStateSnapshot {
  const keys: Record<string, string> = {}
  if (typeof localStorage !== 'undefined') {
    for (const k of TRACKED) {
      const v = localStorage.getItem(k)
      if (v !== null) keys[k] = v
    }
  }
  return { keys, capturedAt: new Date().toISOString() }
}

export function applyLocalSnapshot(s: LocalStateSnapshot): void {
  if (typeof localStorage === 'undefined') return
  for (const k of TRACKED) {
    const v = s.keys[k]
    if (typeof v === 'string') localStorage.setItem(k, v)
  }
}
