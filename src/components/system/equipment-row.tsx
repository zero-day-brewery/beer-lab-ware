'use client'
import { type ReactNode, useId } from 'react'

/**
 * Generic equipment-row shell factored out of the fermenter accordion: an accent
 * rail + collapsed summary button + chevron + per-row delete, wrapping an
 * expandable detail. Fermenter, brew-system, cooler, and gear rows all COMPOSE
 * this — they supply their own `summary` cluster and `children` detail.
 *
 * Single-expand is owned by the PARENT: it passes `expanded` + `onToggle`, so a
 * caller can keep exactly one row open at a time (see `expandedFerm` in
 * `system-view.tsx` and `expandedId` in `gear-view.tsx`).
 */
export function EquipmentRow({
  color,
  on,
  brewing = false,
  hasAlert = false,
  expanded,
  onToggle,
  panelLabel,
  summary,
  deleteLabel,
  onDelete,
  children,
}: {
  color: string
  on: boolean
  brewing?: boolean
  hasAlert?: boolean
  expanded: boolean
  onToggle: () => void
  panelLabel: string
  summary: ReactNode
  deleteLabel: string
  onDelete: () => void
  children: ReactNode
}) {
  const panelId = useId()
  return (
    <div
      className={`ferm-row ${on ? 'on' : 'off'} ${brewing ? 'brewing' : ''} ${
        expanded ? 'is-open' : ''
      } ${hasAlert ? 'has-alert' : ''}`}
      style={{ ['--fc' as string]: color }}
    >
      <div className="ferm-row-head">
        <button
          type="button"
          className="ferm-row-summary"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {summary}
          <svg
            className="ferm-chevron"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              d="M6 9l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="btn-ghost danger ferm-row-delete"
          aria-label={deleteLabel}
          onClick={onDelete}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div className="ferm-row-detail-wrap">
        <div className="ferm-row-detail-clip">
          {expanded && (
            <section
              id={panelId}
              aria-label={panelLabel}
              className="ferm-row-detail animate-in fade-in-0 slide-in-from-top-2"
            >
              {children}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
