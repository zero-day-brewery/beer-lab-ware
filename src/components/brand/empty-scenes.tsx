// Empty-state illustrations — one shared vocabulary: 160×120 line art, amber
// subject + cyan data accents, decorative only (pages keep their text copy).
import type React from 'react'

import { BRAND_AMBER, BRAND_CYAN, BRAND_FOAM } from '@/components/brand/brand-mark'

type SceneProps = { size?: number; className?: string }

function sceneAttrs({ size = 150, className }: SceneProps): React.SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 160 120',
    width: size,
    height: (size * 120) / 160,
    className,
    'aria-hidden': 'true',
    focusable: 'false',
  }
}

// Open recipe book + flask on a faint lab grid.
export function RecipesEmptyScene(props: SceneProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative SVG with aria-hidden="true"
    <svg {...sceneAttrs(props)}>
      <g stroke={BRAND_CYAN} strokeWidth="0.5" opacity="0.15">
        <line x1="0" y1="30" x2="160" y2="30" />
        <line x1="0" y1="60" x2="160" y2="60" />
        <line x1="0" y1="90" x2="160" y2="90" />
        <line x1="40" y1="0" x2="40" y2="120" />
        <line x1="80" y1="0" x2="80" y2="120" />
        <line x1="120" y1="0" x2="120" y2="120" />
      </g>
      <path
        d="M20 92 V38 q20 -8 34 0 v54 q-14 -8 -34 0 z"
        fill="none"
        stroke={BRAND_AMBER}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M88 92 V38 q-20 -8 -34 0 v54 q14 -8 34 0 z"
        fill="none"
        stroke={BRAND_AMBER}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <g stroke={BRAND_CYAN} strokeWidth="2" opacity="0.7">
        <line x1="28" y1="50" x2="46" y2="47" />
        <line x1="28" y1="60" x2="46" y2="57" />
        <line x1="28" y1="70" x2="46" y2="67" />
      </g>
      <path
        d="M116 34 h16 v4 h-3 v14 l13 26 c2.5 5 -1 9 -6.5 9 h-23 c-5.5 0 -9 -4 -6.5 -9 l13 -26 V38 h-3 z"
        fill="none"
        stroke={BRAND_AMBER}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M114.5 62 l-7 14 c-1.5 3 0.5 5.5 4 5.5 h21 c3.5 0 5.5 -2.5 4 -5.5 l-7 -14 c-5 3 -10 3 -15 0 z"
        fill={BRAND_FOAM}
        opacity="0.85"
      />
    </svg>
  )
}

// Sparse shelf, one lone sack.
export function InventoryEmptyScene(props: SceneProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative SVG with aria-hidden="true"
    <svg {...sceneAttrs(props)}>
      <line x1="16" y1="92" x2="144" y2="92" stroke={BRAND_AMBER} strokeWidth="3.5" />
      <line x1="16" y1="52" x2="144" y2="52" stroke={BRAND_AMBER} strokeWidth="3.5" opacity="0.4" />
      <path
        d="M62 92 v-24 q0 -8 8 -10 l-3 -6 h26 l-3 6 q8 2 8 10 v24 z"
        fill="none"
        stroke={BRAND_AMBER}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <line x1="72" y1="76" x2="88" y2="76" stroke={BRAND_CYAN} strokeWidth="2" opacity="0.7" />
      <circle cx="130" cy="46" r="3" fill={BRAND_CYAN} opacity="0.6" />
    </svg>
  )
}

// Single mother cell, dashed ghost of the bud to come — the mark's origin story.
export function YeastEmptyScene(props: SceneProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative SVG with aria-hidden="true"
    <svg {...sceneAttrs(props)}>
      <circle cx="80" cy="64" r="28" fill="none" stroke={BRAND_AMBER} strokeWidth="5" />
      <circle cx="73" cy="56" r="6" fill={BRAND_FOAM} />
      <circle
        cx="112"
        cy="36"
        r="14"
        fill="none"
        stroke={BRAND_CYAN}
        strokeWidth="3"
        strokeDasharray="4 5"
        opacity="0.7"
      />
    </svg>
  )
}

// Empty carboy + flatlined gravity trace.
export function LogbookEmptyScene(props: SceneProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative SVG with aria-hidden="true"
    <svg {...sceneAttrs(props)}>
      <path
        d="M66 26 h14 v10 q16 6 16 24 v26 q0 10 -10 10 h-26 q-10 0 -10 -10 v-26 q0 -18 16 -24 z"
        fill="none"
        stroke={BRAND_AMBER}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M104 72 h14 l5 -8 5 8 h20"
        fill="none"
        stroke={BRAND_CYAN}
        strokeWidth="2.5"
        opacity="0.8"
      />
    </svg>
  )
}
