import { defineConfig, devices } from '@playwright/test';

// Throwaway config for the visual screenshot harness: reuse the already-running
// dev servers instead of spawning fresh ones.
export default defineConfig({
  testDir: './e2e',
  testMatch: /shots\.spec\.ts/,
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    viewport: { width: 390, height: 844 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
});
