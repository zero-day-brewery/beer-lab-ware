'use client'
/**
 * Companion v2 Stage B — a single proposed-action card (Approve / Discard).
 *
 * SAFETY INVARIANT: the agent proposes; the WRITE happens ONLY when the human
 * clicks Approve. This card renders ONE {@link ActionDescriptor} (its title + a
 * TRUTHFUL preview computed at propose time) and the two controls. `applyAction`
 * — the sole write path (Stage A) — is called ONLY from the Approve handler,
 * NEVER on render/mount and NEVER in the agent loop.
 *
 * States: `pending` → (Approve) `applying` → `applied` (shows the write result) ·
 * (Discard) `dismissed` · (`applyAction` `{ok:false}` or a throw) `error` with a
 * Retry. A `busyRef` lock GUARDS double-apply: a card commits at most once; a
 * second Approve while in-flight or after success is a no-op, but a Retry after an
 * ERROR is allowed. `apply` is injectable so tests drive it with a fake — no repo,
 * no Dexie.
 */

import { useRef, useState } from 'react'
import { type ApplyOutput, type ApplyResult, applyAction } from '@/lib/ai/actions/apply'
import type { ActionDescriptor, ActionType } from '@/lib/ai/actions/types'

/** Short kind label shown above the title. */
const KIND_LABEL: Record<ActionType, string> = {
  scale_recipe: 'Scale recipe',
  create_recipe: 'New recipe',
  log_reading: 'Log reading',
  adjust_inventory: 'Adjust stock',
}

/** Human confirmation of what a committed write produced. */
function successText(out: ApplyOutput): string {
  switch (out.kind) {
    case 'recipe':
      return `Saved "${out.recipe.name}"`
    case 'reading':
      return `Logged SG ${out.reading.gravity}`
    case 'inventory':
      return `Stock now ${out.newAmount}`
  }
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const fmtOG = (og: number): string => og.toFixed(3)

type CardState =
  | { phase: 'pending' }
  | { phase: 'applying' }
  | { phase: 'applied'; message: string }
  | { phase: 'dismissed' }
  | { phase: 'error'; error: string }

export interface ActionCardProps {
  action: ActionDescriptor
  /**
   * The write path. Injectable for tests; defaults to the real `applyAction`
   * (which commits through the atomic repos via `defaultActionWriteDeps`).
   */
  apply?: (action: ActionDescriptor) => Promise<ApplyResult>
}

/** The truthful preview body — a before→after grid for a scale, else the string. */
function ActionPreview({ action }: { action: ActionDescriptor }) {
  if (action.type === 'scale_recipe') {
    const { recipeName, before, after } = action.preview
    return (
      <div className="action-card-scale">
        <p className="action-card-recipe">{recipeName}</p>
        <dl className="action-card-diff">
          <div>
            <dt>Batch size</dt>
            <dd>
              <span className="action-card-before">{before.batchSize_L} L</span>
              <span aria-hidden="true"> → </span>
              <span className="action-card-after">{after.batchSize_L} L</span>
            </dd>
          </div>
          <div>
            <dt>OG</dt>
            <dd>
              <span className="action-card-before">{fmtOG(before.OG)}</span>
              <span aria-hidden="true"> → </span>
              <span className="action-card-after">{fmtOG(after.OG)}</span>
            </dd>
          </div>
        </dl>
      </div>
    )
  }
  return <p className="action-card-preview-text">{action.preview}</p>
}

export function ActionCard({ action, apply = applyAction }: ActionCardProps) {
  const [state, setState] = useState<CardState>({ phase: 'pending' })
  // Commit lock: closes the tiny window between a click and the state re-render so a
  // double-click can't fire two writes. Released again only on error (Retry allowed).
  const busyRef = useRef(false)

  async function onApprove() {
    if (busyRef.current) return
    if (state.phase !== 'pending' && state.phase !== 'error') return
    busyRef.current = true
    setState({ phase: 'applying' })
    try {
      const res = await apply(action)
      if (res.ok) {
        // Committed — leave the lock ENGAGED so the card can never write twice.
        setState({ phase: 'applied', message: successText(res.result) })
      } else {
        setState({ phase: 'error', error: res.error })
        busyRef.current = false // a Retry is allowed after a failed write
      }
    } catch (err) {
      setState({ phase: 'error', error: errText(err) })
      busyRef.current = false
    }
  }

  function onDiscard() {
    // Can't discard mid-write or after a commit.
    if (state.phase === 'applying' || state.phase === 'applied') return
    setState({ phase: 'dismissed' })
  }

  const applying = state.phase === 'applying'
  const approveLabel = applying ? 'Saving…' : state.phase === 'error' ? 'Retry' : 'Approve'

  return (
    <section className="tap-card action-card" aria-label={action.title} aria-busy={applying}>
      <div className="action-card-head">
        <span className="action-card-kind">{KIND_LABEL[action.type]}</span>
        <h4 className="action-card-title">{action.title}</h4>
      </div>

      <div className="action-card-preview">
        <ActionPreview action={action} />
      </div>

      {state.phase === 'applied' ? (
        <p className="mini-alert go action-card-status" role="status">
          ✓ {state.message}
        </p>
      ) : state.phase === 'dismissed' ? (
        <p className="action-card-dismissed" role="status">
          Discarded — nothing was written.
        </p>
      ) : (
        <>
          {state.phase === 'error' && (
            <p className="mini-alert warn action-card-status" role="alert">
              Couldn’t apply: {state.error}
            </p>
          )}
          <div className="action-card-actions">
            <button
              type="button"
              className="btn-primary action-card-approve"
              onClick={onApprove}
              disabled={applying}
              aria-label={`${approveLabel}: ${action.title}`}
            >
              {approveLabel}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onDiscard}
              disabled={applying}
              aria-label={`Discard: ${action.title}`}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </section>
  )
}
