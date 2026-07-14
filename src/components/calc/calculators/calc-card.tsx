'use client'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/**
 * Shared shell for a single calculator on the /calculators page. Reuses the
 * metal-cyberpunk `.calc-block` steel panel (top-edge sheen comes for free from
 * the theme) with a cyan `.chip-icon` glyph, an amber `.calc-block-title`, and a
 * faint caption. No colors are hardcoded — the icon rides `text-primary` (cyan)
 * and outputs use `.gauge-value` (recolored wort-amber by the theme).
 */
export function CalcCard({
  icon,
  title,
  caption,
  children,
}: {
  icon: ReactNode
  title: string
  caption?: string
  children: ReactNode
}) {
  return (
    <section className="calc-block flex flex-col gap-3 !p-4">
      <header className="flex items-center gap-3">
        <span aria-hidden="true" className="chip-icon text-primary">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="calc-block-title !mb-0 !text-[0.72rem]">{title}</h2>
          {caption ? <p className="text-[0.68rem] text-muted-foreground">{caption}</p> : null}
        </div>
      </header>
      {children}
    </section>
  )
}

/** A labelled steel number/text input (cyan focus ring via `.field`). */
export function CalcField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input className="field font-mono" {...props} />
    </label>
  )
}

/** A labelled steel select (reuses the `.field` chrome). */
export function CalcSelect({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select className="field" {...props}>
        {children}
      </select>
    </label>
  )
}

/**
 * A result tile. Reuses `.gaugecard.is-neutral` so the big value renders in
 * wort-amber mono under the metal-cyberpunk theme. `value` should already be a
 * formatted string (or a dash when the inputs are invalid — never a raw NaN).
 */
export function CalcOutput({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="gaugecard is-neutral">
      <div className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className="gauge-value">{value}</span>
      </div>
      {hint ? (
        <div className="gauge-foot">
          <span className="gauge-range">{hint}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Two-column input grid used inside a card. */
export function CalcInputs({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>
}

/** Stack of output tiles. */
export function CalcOutputs({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>
}

const DASH = '—'

export { DASH }
