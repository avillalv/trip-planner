import path from 'node:path'
import { defineConfig } from '@playwright/test'

// The smoke test runs the built app against the TEST database on its own port, so your trips are
// never touched, and it can run while `npm start` is up. Run it with `npm run test:e2e` from the
// repo root (that builds the frontend first).
const PORT = 8011
const backend = path.resolve(import.meta.dirname, '../backend')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Edge comes with Windows, so nothing extra to download. For Chromium instead, run
    // `npx playwright install chromium` and set E2E_BROWSER_CHANNEL=chromium.
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
    viewport: { width: 1300, height: 1000 },
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Start from an empty test database each run, then serve the app on the test port.
    command: `uv run --no-sync python -m tests.e2e_seed reset && uv run --no-sync trip-planner web --port ${PORT} --test-db`,
    cwd: backend,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
