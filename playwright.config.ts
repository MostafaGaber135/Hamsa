import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a local Supabase, never the real project. Run them with
 * `npm run test:e2e`, which passes the local address and key in E2E_SUPABASE_URL and
 * E2E_SUPABASE_KEY; the app is built and served with those settings.
 */
const PORT = 4173

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // The service worker would cache the app between runs.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Variables set here win over .env.local, so the build talks to the local Supabase.
    env: {
      VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? '',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.E2E_SUPABASE_KEY ?? '',
      VITE_SENTRY_DSN: '',
    },
  },
})
