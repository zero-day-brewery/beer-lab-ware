'use client'
import { type KeyboardEvent, useState } from 'react'

const STARS = [1, 2, 3, 4, 5] as const
const MAX = 5

function starLabel(n: number): string {
  return `${n} ${n === 1 ? 'star' : 'stars'}`
}

/**
 * Read-only inline stars for lists/summaries. Non-interactive (no buttons, no
 * radiogroup) — just an accessible label + filled/empty glyphs. Token-driven.
 */
export function StarRatingDisplay({ value, className }: { value: number; className?: string }) {
  const filled = Math.max(0, Math.min(MAX, Math.round(value)))
  return (
    <span
      className={`star-rating-readonly${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`${filled} of ${MAX} stars`}
    >
      {STARS.map((n) => (
        <span
          key={n}
          aria-hidden="true"
          className={`star-rating-star${n <= filled ? ' is-filled' : ''}`}
        >
          ★
        </span>
      ))}
    </span>
  )
}

/**
 * Interactive 0–5 star rating. Accessible `radiogroup` of five star buttons with
 * a roving tabindex; arrow/Home/End keys move the value, clicking the active star
 * (or the Clear affordance / Home key) resets to 0. Filled/empty colours come from
 * `var(--wort, var(--malt))` / `var(--border)` — no hardcoded colours.
 */
export function StarRating({
  value,
  onChange,
  label = 'Rating',
}: {
  value: number
  onChange: (value: number) => void
  label?: string
}) {
  // The star that owns tab focus (roving tabindex). Falls back to star 1 when unrated.
  const [focusIndex, setFocusIndex] = useState(() => (value >= 1 ? value : 1))

  function set(next: number) {
    const clamped = Math.max(0, Math.min(MAX, next))
    onChange(clamped)
    if (clamped >= 1) setFocusIndex(clamped)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        set(value + 1)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        set(value - 1)
        break
      case 'Home':
        e.preventDefault()
        set(0)
        break
      case 'End':
        e.preventDefault()
        set(MAX)
        break
    }
  }

  return (
    <div className="star-rating-wrap">
      <div className="star-rating" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {STARS.map((n) => (
          // biome-ignore lint/a11y/useSemanticElements: custom radiogroup — roving tabindex + click-active-star-to-clear, which native <input type="radio"> can't express
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={starLabel(n)}
            tabIndex={n === focusIndex ? 0 : -1}
            // Click the active star to clear back to 0 (toggle-off).
            onClick={() => set(value === n ? 0 : n)}
            onFocus={() => setFocusIndex(n)}
            className={`star-rating-star star-rating-btn${n <= value ? ' is-filled' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
      {value > 0 && (
        <button
          type="button"
          className="star-rating-clear"
          onClick={() => set(0)}
          aria-label="Clear rating"
        >
          Clear
        </button>
      )}
    </div>
  )
}
