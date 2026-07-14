import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: CI,
  workers: CI ? 1 : undefined,
  retries: CI ? 2 : 0,
  reporter: CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3030',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:3030',
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
})
