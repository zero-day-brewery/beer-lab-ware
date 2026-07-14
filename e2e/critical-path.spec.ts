import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { FIXTURE_BATCH_ID, FIXTURE_RECIPE_NAME } from './fixtures/constants'

const FIXTURE = path.resolve(__dirname, 'fixtures/seed.dump.json')
const STEP1_RECIPE = 'E2E Smoke Ale'
const CHART_MARKS = '[data-testid="fermentation-chart"] path, [data-testid="fermentation-chart"] circle'

// Zod v4 feature-detects eval via `new Function('')` guarded by try/catch (see
// zod/v4/core/util.js `allowsEval`). The hash CSP CORRECTLY blocks that at the browser
// level — production protection is intact, which is the whole point — but the swallowed
// throw still surfaces a securitypolicyviolation ('script-src eval') and/or a console
// error. Allowlist ONLY this eval block: it reports the literal `eval` keyword, never a
// resource URL. eval is the sole such caller in the app, so every REAL refusal still
// fails the net — an inline-script hash miss reports blockedURI 'inline', a blocked fetch
// reports a URL. (The security-preserving fix per E5 review; `z.config({jitless:true})`
// would silence the probe at the source but that is a forbidden src/** change.)
const isBenignEvalProbe = (entry: string) => /\beval\b/i.test(entry) && !/https?:\/\//i.test(entry)

test.describe('critical path', () => {
  const consoleCsp: string[] = []
  const violations: string[] = []

  test.beforeEach(async ({ page }) => {
    consoleCsp.length = 0
    violations.length = 0
    // CSP net over the pages this test visits. The build-time self-verify pass is the
    // enforcement of record (every page, incl. deep-links this smoke never opens);
    // these two are the secondary net over visited pages:
    //   (1) console scan — Node-side, persists across navigations (both engines log a
    //       console error on a CSP refusal);
    //   (2) securitypolicyviolation → __reportCsp — exposeFunction survives navigation,
    //       so per-page DOM violations are captured in real time (fixes the old
    //       "only the last page's window.__csp survives a page.goto" gap).
    await page.exposeFunction('__reportCsp', (v: string) => {
      violations.push(v)
    })
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        ;(window as unknown as { __reportCsp: (v: string) => void }).__reportCsp(
          `${e.violatedDirective} ${e.blockedURI}`,
        )
      })
    })
    page.on('console', (m) => {
      if (/content security policy/i.test(m.text())) consoleCsp.push(m.text())
    })
    // onImport fires ONE confirm() (+ a harmless current-data backup download); onWipe
    // fires TWO confirm(). Auto-accept every dialog up-front.
    page.on('dialog', (d) => d.accept())
  })

  test('recipe → brew → readings → export → wipe → restore', async ({ page }) => {
    // 1. Import the Tier-2 fixture through the REAL Import JSON path (Zod-guarded).
    await page.goto('/settings/')
    await page.getByLabel('Import JSON').setInputFiles(FIXTURE)
    await expect(page.getByText(/Imported backup/i)).toBeVisible()

    // 2. Create the step-1 recipe live (added on top of the fixture set).
    await page.goto('/recipes/new/')
    await page.getByPlaceholder('SMaSH Pale Ale').fill(STEP1_RECIPE)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).toHaveURL(/\/recipes\/view\/\?id=/)

    // 3. Guided brew: open the gate, confirm, land on the runner with a session uuid.
    // Confirm & start is disabled={allOccupied} — it needs ≥1 fermenter with status
    // 'empty', which comes from Tier-1 SeedOnMount's default board (NOT the fixture —
    // see the Flow rationale). Assert enabled so a full board fails loudly here rather
    // than hanging on a disabled button. A recipe is NOT required (recipeId='' is valid).
    await page.goto('/system/')
    await page.getByRole('button', { name: /Start a brew/ }).click()
    const confirmBtn = page.getByRole('button', { name: /Confirm & start/ })
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()
    await expect(page).toHaveURL(/\/system\/run\/\?session=[0-9a-f-]{36}/)

    // 4. Readings + E4 chart: the fixture batch has readings → the chart renders marks.
    // The svg[data-testid=fermentation-chart] only mounts after TimeSeriesChart's
    // rAF-throttled ResizeObserver reports width>0 (ready=true); before that it shows
    // chart-skeleton/chart-empty with no testid. .first().toBeVisible() auto-waits for
    // that flip in the default 1280×720 viewport, so no explicit wait is needed.
    await page.goto(`/logbook/view/?id=${FIXTURE_BATCH_ID}`)
    await expect(page.locator(CHART_MARKS).first()).toBeVisible()
    expect(await page.locator(CHART_MARKS).count()).toBeGreaterThan(0)

    // 5. Export: register the download BEFORE the click; assert file CONTENT (not filename — WebKit differs).
    await page.goto('/settings/')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export backup/ }).click()
    const download = await downloadPromise
    const dump = JSON.parse(readFileSync(await download.path(), 'utf8'))
    expect(dump.tables.recipes.map((r: { name: string }) => r.name)).toContain(STEP1_RECIPE)
    expect(dump.tables.recipes.map((r: { name: string }) => r.name)).toContain(FIXTURE_RECIPE_NAME)
    expect(dump.tables.readings.length).toBeGreaterThan(0)

    // 6. Wipe (two confirm() dialogs, auto-accepted) → data gone. The toast is a fast
    // signal; the persistent 'Batch not found' below is the assertion of record.
    await page.getByRole('button', { name: 'Wipe ALL data' }).click()
    await expect(page.getByText(/All data wiped/i)).toBeVisible()
    await page.goto(`/logbook/view/?id=${FIXTURE_BATCH_ID}`)
    await expect(page.getByText(/Batch not found/i)).toBeVisible()

    // 7. Restore the fixture → recipe + readings survive.
    await page.goto('/settings/')
    await page.getByLabel('Import JSON').setInputFiles(FIXTURE)
    await expect(page.getByText(/Imported backup/i)).toBeVisible()
    await page.goto(`/logbook/view/?id=${FIXTURE_BATCH_ID}`)
    // Same rAF-throttled ready-flip race as step 4 (webkit mounts the svg slower than
    // chromium): auto-wait for the chart to render before the non-retrying count().
    await expect(page.locator(CHART_MARKS).first()).toBeVisible()
    expect(await page.locator(CHART_MARKS).count()).toBeGreaterThan(0)

    // CSP net (secondary to the build-time self-verify) over every page this test visited.
    // Drop Zod's benign eval feature-probe (see isBenignEvalProbe); any other refusal fails.
    const cspEvents = [...consoleCsp, ...violations].filter((e) => !isBenignEvalProbe(e))
    expect(cspEvents).toEqual([])
  })
})
