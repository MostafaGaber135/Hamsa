import { execSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a local Supabase (npm run db:start), never the real project.
 * The app is built and served with those settings; the keys come from `supabase status`
 * unless E2E_SUPABASE_URL and E2E_SUPABASE_KEY are set.
 */
function localSupabase() {
  if (process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_KEY) {
    return { url: process.env.E2E_SUPABASE_URL, key: process.env.E2E_SUPABASE_KEY }
  }
  const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }))
  return { url: status.API_URL as string, key: (status.PUBLISHABLE_KEY ?? status.ANON_KEY) as string }
}

const supabase = localSupabase()
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
    env: { VITE_SUPABASE_URL: supabase.url, VITE_SUPABASE_PUBLISHABLE_KEY: supabase.key, VITE_SENTRY_DSN: '' },
  },
})
