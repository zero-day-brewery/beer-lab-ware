// tests/helpers/resize-observer.ts

/** Install a jsdom-friendly ResizeObserver (jsdom ships none). It reports a
 *  fixed content width as soon as an element is observed, letting charts pass
 *  their `ready = width > 0` gate in tests. Returns a restore function. */
export function installResizeObserver(width = 640): () => void {
  const prev = globalThis.ResizeObserver
  class RO {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(el: Element): void {
      this.cb(
        [{ target: el, contentRect: { width, height: 0 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver
  return () => {
    globalThis.ResizeObserver = prev
  }
}
