import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    viewport: { width: 430, height: 932 }, // mobile-first portrait
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 } },
    },
  ],
  webServer: [
    {
      command: 'npm -w server run start',
      url: 'http://localhost:8787/health',
      reuseExistingServer: false,
      timeout: 30000,
      env: { RECONNECT_GRACE_MS: '2500' },
    },
    {
      command: 'npm -w client run dev',
      url: 'http://localhost:5180',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
