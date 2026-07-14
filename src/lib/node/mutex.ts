/**
 * A tiny promise-chaining mutex: `run(fn)` serializes async work so two writes
 * can never interleave. Each call queues behind the previous one's settlement
 * (success OR failure — a rejection never wedges the chain). Node-only, no deps.
 *
 * Shared by the MCP tool server (serializing CallTool writes) and the Track B
 * sync daemon (serializing concurrent `PUT /state` writes so a `GET` never reads
 * a torn file).
 */
export type Mutex = <T>(fn: () => Promise<T>) => Promise<T>

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn, fn)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
