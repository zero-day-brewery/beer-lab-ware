import { Suspense } from 'react'
import { GuidedRunner } from '@/components/system/run/guided-runner'

/**
 * Guided brew runner — query-param route `/system/run/?session=<uuid>`.
 * NO `[id]` dynamic folder: those 404 under `serve out` (static export).
 *
 * E2E happy-path (manual): `npm run build` then `npm run serve`, open
 * `/system/?` , click a station → BrewStartGate → Confirm → land on
 * `/system/run/?session=<uuid>`, advance a step, reload, confirm the
 * session rehydrates to its cursor. Do NOT use `next dev` for this — it
 * masks both the query-param routing and the Tailwind print CSS.
 */
export default function SystemRunPage() {
  return (
    <Suspense
      fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading brew…</p>}
    >
      <GuidedRunner />
    </Suspense>
  )
}
