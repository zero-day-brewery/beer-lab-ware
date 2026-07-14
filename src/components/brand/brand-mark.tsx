// Beer-Lab-Ware brand mark — "Generation Trail": three yeast generations
// budding diagonally up-right, amber fading to cyan. The lineage is the brand:
// the Yeast Bank tracks exactly this repitch chain, so keep 3 generations in
// any refinement.
// Token fallbacks follow the globals.css convention: --wort exists only in
// metal-cyberpunk (where it aliases --malt); --malt/--primary/--foam exist in
// all 6 themes.

export const BRAND_AMBER = 'var(--wort, var(--malt, #f59e0b))'
export const BRAND_CYAN = 'var(--primary, #22d3ee)'
export const BRAND_FOAM = 'var(--foam, #fbbf24)'

type BrandProps = { size?: number; className?: string }

// No in-app consumer yet — reserved for large surfaces (Yeast Bank etc.); PWA icons + hero use static duplicates (docs/brand-assets.md).
export function BrandMark({ size = 48, className }: BrandProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="46" cy="72" r="25" fill="none" stroke={BRAND_AMBER} strokeWidth="5" />
      <circle
        cx="76"
        cy="47"
        r="14"
        fill="none"
        stroke={BRAND_AMBER}
        strokeWidth="4.5"
        opacity="0.85"
      />
      <circle cx="95" cy="28" r="7.5" fill="none" stroke={BRAND_CYAN} strokeWidth="4" />
      <circle cx="40" cy="65" r="5" fill={BRAND_FOAM} />
    </svg>
  )
}

// 2-cell cut for 16–32px slots — the third generation blurs below ~24px.
export function BrandMarkSmall({ size = 22, className }: BrandProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="52" cy="68" r="30" fill="none" stroke={BRAND_AMBER} strokeWidth="9" />
      <circle cx="88" cy="36" r="16" fill="none" stroke={BRAND_CYAN} strokeWidth="9" />
      <circle cx="44" cy="60" r="6.5" fill={BRAND_FOAM} />
    </svg>
  )
}
