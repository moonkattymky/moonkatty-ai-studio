import { defineConfig } from '@playwright/test';
import { IPHONE_16_PRO } from '../device.mjs';
import { EMPTY, SEEDED, IDLE, STUDIO_DIR, TEST_PASSWORD, TEST_USER, LOGS } from './fixture.mjs';
// LIVE mode: real MOONKATTY AI STUDIO servers (integ d1adf4d worktree, TEST flavour, temp data dirs) + the AI CONTROL proxy.
// Run: sh test/live/run.sh  (builds dist/ once, then runs inside the private network namespace /workspace/mk-iso.sh)
const iphone = IPHONE_16_PRO;
const studio = (c, extra = '') => `mkdir -p ${LOGS} && rm -rf ${c.data} && cd ${STUDIO_DIR} && ${extra} NODE_ENV=test STUDIO_FLAVOR=test STUDIO_DATA_DIR=${c.data} PORT=${c.studio} STUDIO_ADMIN_USER=${TEST_USER} STUDIO_ADMIN_PASSWORD=${TEST_PASSWORD} node server.js > ${LOGS}/studio-${c.studio}.log 2>&1`;
const proxy = (port, studioPort, extra = '') => `mkdir -p ${LOGS} && ${extra} STUDIO_URL=http://127.0.0.1:${studioPort} PORT=${port} node server.mjs --no-build > ${LOGS}/proxy-${port}.log 2>&1`;
export default defineConfig({
  testDir: '.',
  outputDir: '/workspace/out/ai-control/stage2/pw-artifacts',
  testMatch: /.*\.live\.mjs/,
  timeout: 300_000,
  fullyParallel: false,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: '/workspace/out/ai-control/stage2/live-results.json' }]],
  globalSetup: './seed.mjs',
  use: { baseURL: `http://127.0.0.1:${EMPTY.proxy}/`, trace: 'off' },
  webServer: [
    { command: studio(EMPTY), url: `http://127.0.0.1:${EMPTY.studio}/api/health`, reuseExistingServer: false, timeout: 60_000 },
    { command: studio(SEEDED, 'STUDIO_OPS_UPDATE=1'), url: `http://127.0.0.1:${SEEDED.studio}/api/health`, reuseExistingServer: false, timeout: 60_000 },
    { command: proxy(EMPTY.proxy, EMPTY.studio), cwd: '../..', url: `http://127.0.0.1:${EMPTY.proxy}/`, reuseExistingServer: false, timeout: 60_000 },
    { command: proxy(SEEDED.proxy, SEEDED.studio), cwd: '../..', url: `http://127.0.0.1:${SEEDED.proxy}/`, reuseExistingServer: false, timeout: 60_000 },
    { command: proxy(IDLE.proxy, EMPTY.studio, `AIC_IDLE_SEC=${IDLE.idleSec}`), cwd: '../..', url: `http://127.0.0.1:${IDLE.proxy}/`, reuseExistingServer: false, timeout: 60_000 },
  ],
  projects: [
    { name: 'webkit-iphone16pro', use: { ...iphone, browserName: 'webkit' } },
    { name: 'chromium-iphone16pro', use: { ...iphone, browserName: 'chromium' } },
  ],
});
