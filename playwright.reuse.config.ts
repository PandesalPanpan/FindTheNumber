import { defineConfig, devices } from '@playwright/test';

// Run the real e2e specs against already-running dev servers (8787 + 5180).
export default defineConfig({
  testDir: './e2e',
  testIgnore: /shots\.spec\.ts/,
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    viewport: { width: 430, height: 932 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 } } },
  ],
});
