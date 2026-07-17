import { expect, test } from '@playwright/test'

/**
 * Regression lock for the Settings units toggle: flipping to imperial must
 * flip the recipe editor's batch-size field to gallons (label + converted
 * value), and flipping back must restore liters. Storage stays canonical
 * metric — only the display converts — so the seeded 19 L default reads
 * 5.019 gal in imperial mode and 19 again after the round trip.
 */
test.describe('imperial display units', () => {
  test('settings toggle flips the recipe editor batch size gal ↔ L', async ({ page }) => {
    // Flip to imperial (SettingsView self-creates the settings row on mount).
    await page.goto('/settings/')
    const unitsSelect = page.getByLabel('Units')
    await unitsSelect.selectOption('imperial')
    // The select re-renders from the Dexie liveQuery — confirms the write landed.
    await expect(unitsSelect).toHaveValue('imperial')

    await page.goto('/recipes/new/')
    await expect(page.getByText('Batch size (gal)')).toBeVisible()
    await expect(page.getByLabel(/batch size/i)).toHaveValue('5.019')

    // Flip back to metric.
    await page.goto('/settings/')
    await page.getByLabel('Units').selectOption('metric')
    await expect(page.getByLabel('Units')).toHaveValue('metric')

    await page.goto('/recipes/new/')
    await expect(page.getByText('Batch size (L)')).toBeVisible()
    await expect(page.getByLabel(/batch size/i)).toHaveValue('19')
  })
})
