import { defineConfig, devices } from '@playwright/test';

// Three projects, text assertions only (screenshots, video and traces are off):
//   smoke — the app loads (real client, :5175)
//   mock  — UI against the mock client (VITE_USE_MOCK=true, :5174, no backend)
//   live  — UI against the running stack via the Vite /api proxy (:5175 -> :4000);
//           skipped when the backend is not running (tools/run-local.ps1 -Start)
// The test servers set VITE_USE_MOCK explicitly (process.env overrides .env files),
// so a developer's .env.local cannot silently turn the live run into a mock run.
const chrome = { ...devices['Desktop Chrome'], screenshot: 'off', video: 'off', trace: 'off' };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list']],
  timeout: 90000,
  use: { screenshot: 'off', video: 'off', trace: 'off' },
  projects: [
    { name: 'smoke', testMatch: /smoke\.spec\.js/, use: { ...chrome, baseURL: 'http://localhost:5175' } },
    { name: 'mock', testMatch: /mock\.spec\.js/, use: { ...chrome, baseURL: 'http://localhost:5174' } },
    { name: 'live', testMatch: /live\.spec\.js/, use: { ...chrome, baseURL: 'http://localhost:5175' } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5175 --strictPort',
      url: 'http://localhost:5175',
      env: { VITE_USE_MOCK: 'false', VITE_CACHE_DIR: 'node_modules/.vite-e2e-live' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { VITE_USE_MOCK: 'true', VITE_CACHE_DIR: 'node_modules/.vite-e2e-mock' },
      reuseExistingServer: false,
    },
  ],
});
