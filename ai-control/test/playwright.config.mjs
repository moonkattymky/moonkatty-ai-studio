import { defineConfig, devices } from '@playwright/test';
// iPhone 15 Pro profile (393×852 @3x, touch, mobile UA). The full-screen viewport mirrors the standalone PWA.
const iphone = { ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 } };
export default defineConfig({
  testDir: '.',
  outputDir: '/workspace/out/ai-control/pw-artifacts',
  testMatch: /.*\.spec\.mjs/,
  timeout: 240_000,
  fullyParallel: true,
  workers: 6,
  reporter: [['list'], ['json', { outputFile: '/workspace/out/ai-control/test-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:8690/', trace: 'off' },
  webServer: { command: 'node server.mjs', cwd: '..', url: 'http://127.0.0.1:8690/', reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: 'webkit-iphone15pro', use: { ...iphone, browserName: 'webkit' } },
    { name: 'chromium-iphone15pro', use: { ...iphone, browserName: 'chromium' } },
  ],
});
