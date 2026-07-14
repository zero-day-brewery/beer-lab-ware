import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
