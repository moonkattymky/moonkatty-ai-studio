import { defineConfig } from '@playwright/test';
import { IPHONE_16_PRO } from './device.mjs';
// iPhone 16 Pro profile (402×874 @3x, touch, iOS 18 UA). The full-screen viewport mirrors the standalone PWA.
const iphone = IPHONE_16_PRO;
export default defineConfig({
  testDir: '.',
  outputDir: '/workspace/out/ai-control/pw-artifacts',
  testMatch: /.*\.spec\.mjs/,
  testIgnore: /live\//,
  timeout: 240_000,
  fullyParallel: true,
  workers: 6,
  reporter: [['list'], ['json', { outputFile: '/workspace/out/ai-control/test-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:8697/', trace: 'off' },
  webServer: { command: 'AIC_MODE=demo AIC_QUIET=1 node server.mjs', cwd: '..', url: 'http://127.0.0.1:8697/', reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: 'webkit-iphone16pro', use: { ...iphone, browserName: 'webkit' } },
    { name: 'chromium-iphone16pro', use: { ...iphone, browserName: 'chromium' } },
  ],
});
