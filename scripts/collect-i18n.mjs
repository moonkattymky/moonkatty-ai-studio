// Collect untranslated Russian UI strings (dev tool). node scripts/collect-i18n.mjs <url> <user> <pass>
import { chromium } from 'playwright-core';
const [url, user, pass] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const out = new Set();
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const p = await (await b.newContext({ viewport: vp })).newPage();
  await p.addInitScript(l => localStorage.setItem('mk-lang', l), process.env.LANG_UI || 'en');
  await p.goto(url); await p.waitForSelector('#auth form, #app:not(.hidden)');
  const dump = async () => (await p.evaluate(() => [...i18n.miss])).forEach(x => out.add(x));
  await dump();
  if (await p.isVisible('#auth form')) { await p.fill('input[name=username]', user); await p.fill('input[name=password]', pass); await p.click('#auth button'); }
  await p.waitForSelector('#app:not(.hidden) #view .card');
  for (const r of ['dashboard', 'agents', 'news', 'project', 'video', 'studio3d', 'social', 'pr', 'calendar', 'analytics', 'reports', 'files', 'logs', 'settings']) {
    await p.evaluate(r => location.hash = r, r); await p.waitForTimeout(250); await dump();
    if (r === 'agents') { await p.click('[data-tab=queue]'); await p.waitForTimeout(200); await p.click('[data-task-new]'); await p.waitForTimeout(200); await dump(); await p.click('[data-close]'); await p.click('[data-tab=cards]'); await p.click('[data-assign]'); await dump(); await p.click('[data-close]'); }
    if (r === 'news') { for (const s of ['#newEp', '[data-script]', '[data-media]', '[data-plan-add]', '[data-task-del]']) { if (await p.$(s)) { await p.click(s); await p.waitForTimeout(200); await dump(); await p.click('[data-close]'); } } }
    if (r === 'social') { if (!(await p.$('[data-tab=queue]'))) {} else { await p.click('#demoLoad'); await p.waitForTimeout(1500); await dump();
      for (const t of ['queue', 'analytics', 'community', 'posts', 'ws:news-fb', 'ws:news-ig', 'ws:mk-fb', 'ws:mk-ig']) { await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(300); await dump();
        if (t === 'queue') { await p.click('#newMat'); await dump(); await p.click('[data-close]'); await p.click('[data-qprev]'); await dump(); await p.click('[data-close]'); await p.click('[data-qhist]'); await dump(); await p.click('[data-close]'); }
        if (t === 'community') { await p.click('[data-cdraft]'); await dump(); await p.click('[data-close]'); }
        if (t === 'posts') { await p.click('#newPost'); await dump(); await p.click('[data-close]'); } }
      await p.click('[data-tab=pages]'); await p.click('#audEdit'); await dump(); await p.click('[data-close]'); await p.click('#fcEdit'); await dump(); await p.click('[data-close]'); await p.click('#demoDel'); await dump(); await p.click('[data-close]'); } }
    if (r === 'pr') { await p.click('#newCamp'); await dump(); await p.click('[data-close]'); }
    if (r === 'settings') { await p.waitForTimeout(500); await dump(); }
    if (r === 'logs') { await p.click('#sysRef'); await p.waitForTimeout(300); await dump(); }
  }
  await p.click('#chatBtn'); await p.waitForTimeout(200); await dump(); await p.click('#chatClose'); await p.click('#bellBtn'); await dump();
}
console.log(JSON.stringify([...out], null, 1)); await b.close();
