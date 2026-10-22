// Скриншоты макетов: Playwright WebKit, iPhone 16 Pro (test/device.mjs) + contact sheet all.png.
import { webkit } from '@playwright/test';
import { IPHONE_16_PRO } from '../../../test/device.mjs';
import { mkdirSync, readFileSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)); const out = process.env.OUT || '/workspace/out/ai-control/alex-mockups';
mkdirSync(out, { recursive: true });
const pages = ['dashboard', 'projects', 'agents', 'tasks', 'studio3d', 'testing', 'files', 'results', 'release', 'notifications', 'settings', 'more'];
const { defaultBrowserType, ...dev } = IPHONE_16_PRO;
const b = await webkit.launch(); const ctx = await b.newContext(dev); const p = await ctx.newPage();
for (const [i, n] of pages.entries()) { await p.goto(pathToFileURL(path.join(dir, n + '.html')).href); await p.waitForLoadState('load');
  await p.screenshot({ path: path.join(out, `${String(i + 1).padStart(2, '0')}-${n}.png`) }); }
await b.close();
const { execFileSync } = await import('node:child_process');
execFileSync('python3', [path.join(dir, 'contact-sheet.py'), out], { stdio: 'inherit' });
console.log('ok', out);
