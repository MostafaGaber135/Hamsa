// Runs the Playwright tests against the local Supabase (start it with npm run db:start).
// Reads its address and publishable key from `supabase status` and hands them to
// playwright.config.ts, which builds the app with them. Extra arguments go to Playwright.
import { execFileSync, spawnSync } from 'node:child_process'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const status = JSON.parse(execFileSync(npx, ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: true }))

const result = spawnSync(npx, ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_SUPABASE_URL: status.API_URL, E2E_SUPABASE_KEY: status.PUBLISHABLE_KEY },
})
process.exit(result.status ?? 1)
