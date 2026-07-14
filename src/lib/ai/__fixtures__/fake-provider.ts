/**
 * A scripted, deterministic `ChatProvider` for headless testing of the agent loop.
 *
 * Not shipped to the app bundle — nothing in `src/` imports it except tests. It
 * replays a queue of `CompleteResponse`s (one per `complete()` call) and records
 * every request it saw, so a test can assert exactly what the loop sent and how
 * many round-trips it made. When the queue drains it returns `fallback` (default:
 * a terminal `end`) — set `fallback` to a `tool_use` to drive the iteration cap.
 */

import type { AiToolCall, ChatProvider, CompleteRequest, CompleteResponse } from '@/lib/ai/types'

export class FakeProvider implements ChatProvider {
  private queue: CompleteResponse[]
  private readonly fallback: CompleteResponse
  /** Every request passed to `complete()`, in order. */
  readonly calls: CompleteRequest[] = []

  constructor(
    scripted: CompleteResponse[],
    fallback: CompleteResponse = { stopReason: 'end', text: '' },
  ) {
    this.queue = [...scripted]
    this.fallback = fallback
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    this.calls.push(req)
    const next = this.queue.shift()
    return next ?? this.fallback
  }

  /** Number of `complete()` round-trips so far. */
  get callCount(): number {
    return this.calls.length
  }
}

/** Script a turn that asks the loop to run one or more tools. */
export function toolUse(toolCalls: AiToolCall[], text?: string): CompleteResponse {
  return { stopReason: 'tool_use', toolCalls, text }
}

/** Script a terminal turn that ends the loop with final text. */
export function finalText(text: string): CompleteResponse {
  return { stopReason: 'end', text }
}
