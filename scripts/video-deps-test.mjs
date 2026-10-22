// Video render dependency diagnostics (ffmpeg, ffprobe, rsvg-convert): API with a substituted PATH (missing / present /
// Homebrew-fallback / partial) and UI (status badge «Рендер: не готово», disabled render buttons) against real servers.
// Binaries are never executed by the check; stubs are empty executable files. Needs playwright-core + Chrome for the UI part.
import { createRequire } from 'module'; import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import net from 'net'; import crypto from 'crypto';
const require = createRequire(import.meta.url); const express = require('express'); const NVmod = require('../lib/news-video.js'); const VD = require('../lib/video-deps.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdeps-')); const mk = (d, bins) => { fs.mkdirSync(d, { recursive: true }); for (const b of bins) { fs.writeFileSync(path.join(d, b), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(d, b), 0o755); } return d; };
const EMPTY = mk(path.join(tmp, 'empty'), []), ALL = mk(path.join(tmp, 'all'), ['ffmpeg', 'ffprobe', 'rsvg-convert']), BREW = mk(path.join(tmp, 'brew'), ['ffmpeg', 'ffprobe', 'rsvg-convert']), NORSVG = mk(path.join(tmp, 'norsvg'), ['ffmpeg', 'ffprobe']);
fs.writeFileSync(path.join(EMPTY, 'ffmpeg'), 'x'); // present but NOT executable → must not count
const ORIG = process.env.PATH; const setEnv = (p, fb) => { process.env.PATH = p; process.env.NV_DEPS_FALLBACK_DIRS = fb; };
// ---- unit
{ const r = VD.check({ PATH: EMPTY, NV_DEPS_FALLBACK_DIRS: '' }); t('unit: all missing (non-executable file ignored)', !r.ok && r.missing.map(m => m.bin).join() === 'ffmpeg,ffprobe,rsvg-convert');
  t('unit: hint dedups packages', r.hint === 'brew install ffmpeg librsvg', r.hint); t('unit: Russian message names what and why', /не найдено ffmpeg \(сборка видео/.test(r.message) && /rsvg-convert \(отрисовка титров/.test(r.message));
  const p = VD.check({ PATH: NORSVG, NV_DEPS_FALLBACK_DIRS: '' }); t('unit: partial → only librsvg', !p.ok && p.missing.length === 1 && p.hint === 'brew install librsvg', p.hint);
  const f = VD.check({ PATH: EMPTY, NV_DEPS_FALLBACK_DIRS: BREW }); t('unit: Homebrew fallback dir resolves (GUI minimal PATH)', f.ok && f.found.ffmpeg === path.join(BREW, 'ffmpeg'));
  t('unit: default fallback dirs are /opt/homebrew/bin, /usr/local/bin', /\/opt\/homebrew\/bin/.test(fs.readFileSync('lib/video-deps.js', 'utf8')) && /\/usr\/local\/bin/.test(fs.readFileSync('lib/video-deps.js', 'utf8')));
  t('unit: module never spawns/executes or installs', !/child_process|execFile|spawn\(/.test(fs.readFileSync('lib/video-deps.js', 'utf8').replace(/\/\/.*$/mg, ''))); }
// ---- API (module app, fixture RSS, fake job service)
const now = new Date('2026-10-22T12:00:00Z'); const rss = it => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${it.map(i => `<item><title>${i.t}</title><link>${i.l}</link><description>${i.d}</description><pubDate>${new Date(now - 3 * 36e5).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const FEEDS = { nasa: rss([{ t: 'NASA Conducts RS-25 Engine Test at Stennis', l: 'https://www.nasa.gov/a1', d: 'NASA fired RS-25 engine for 500 seconds at Stennis Space Center.' }]), 'bbc-science': rss([{ t: 'NASA conducts RS-25 engine test at Stennis center', l: 'https://www.bbc.co.uk/news/b1', d: 'The engine ran for 500 seconds in Mississippi, NASA said.' }]) };
const fetchFn = async url => { const s = NVmod.SOURCES.find(x => x.url === url); return { ok: true, status: 200, text: async () => FEEDS[s.id] || rss([]) }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdeps-nv-')); const jobs = {};
const services = { videoRender: { hasExecutor: () => true }, jobsApi: { createJob: ({ input }) => { const id = 'j' + Object.keys(jobs).length; jobs[id] = { status: 'queued', input, artifacts: [] }; return { jobId: id }; }, getJob: id => jobs[id] } };
const app = express(); app.use(express.json()); app.use((req, res, next) => { req.user = 'igor'; next(); });
NVmod({ app, dataDir: dir, services, runner: { ollamaStatus: async () => ({ ok: false }) }, log: () => {}, fetchFn, now: () => now });
const srv = http.createServer(app).listen(0); const B = `http://127.0.0.1:${srv.address().port}`;
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
try {
  const s = await call('POST', '/api/newsvideo/search'); const rs = s.j.candidates.find(c => /RS-25/.test(c.headline));
  let d = (await call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] })).j; const cur = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j;
  d = (await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: cur.contentHash })).j; t('setup: draft approved', d.status === 'approved', d.status);
  setEnv(EMPTY, '');
  const st = (await call('GET', '/api/newsvideo/status')).j; t('status (missing): ffmpeg/ffprobe/rsvg false, renderReady false', st.ffmpeg === false && st.ffprobe === false && st.rsvg === false && st.renderReady === false);
  t('status (missing): message + hint', st.videoDeps && !st.videoDeps.ok && /Рендер видео не готов/.test(st.videoDeps.message) && st.videoDeps.hint === 'brew install ffmpeg librsvg');
  const r = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' });
  t('render (missing): 424 video_deps_missing', r.s === 424 && r.j.code === 'video_deps_missing', r.s + ' ' + (r.j && r.j.code));
  t('render (missing): details list + hint', r.j.details && r.j.details.missing.length === 3 && r.j.details.hint === 'brew install ffmpeg librsvg'); t('render (missing): Russian error text', /не найдено ffmpeg/.test(r.j.error));
  t('render (missing): no job created', Object.keys(jobs).length === 0); const after = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; t('render (missing): draft not marked rendering/rendered', after.status === 'approved' && after.renders.length === 0, after.status);
  setEnv(NORSVG, ''); const rp = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'shorts' }); t('render (rsvg missing only): 424, lists rsvg-convert', rp.s === 424 && rp.j.details.missing.map(m => m.bin).join() === 'rsvg-convert');
  t('server still alive after refusals', (await call('GET', '/api/newsvideo/drafts')).s === 200);
  setEnv(EMPTY, BREW); const rf = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' }); t('render (only in Homebrew dir): accepted', rf.s === 200 && rf.j.status === 'rendering', rf.s);
  t('Homebrew dir appended to PATH for execFile', process.env.PATH.split(path.delimiter).includes(BREW));
  setEnv(ALL, ''); const st2 = (await call('GET', '/api/newsvideo/status')).j; t('status (present): ffprobe true, deps ok', st2.ffprobe === true && st2.videoDeps.ok && !st2.videoDeps.message);
} finally { srv.close(); setEnv(ORIG, ''); delete process.env.NV_DEPS_FALLBACK_DIRS; fs.rmSync(dir, { recursive: true, force: true }); }
// ---- executor guard (server.js): render job fails cleanly with the same code, before the factory runs
{ const src = fs.readFileSync('server.js', 'utf8'); t('executor guard present before factory render', /async render\(ep, o\) \{ \{ const vd = require\('\.\/lib\/video-deps'\)\.check\(\); if \(!vd\.ok\) throw/.test(src)); }
// ---- UI against real servers (PATH substituted / real)
const { chromium } = await import('playwright-core');
const port = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function ui(label, envPath, fb, expectReady) {
  const PORT = await port(), UD = fs.mkdtempSync(path.join(os.tmpdir(), 'vdeps-ui-')), PW = crypto.randomBytes(12).toString('hex'), U = `http://127.0.0.1:${PORT}`;
  const s = spawn(process.execPath, ['server.js'], { env: { ...process.env, PATH: envPath, NV_DEPS_FALLBACK_DIRS: fb, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: UD, PORT: String(PORT), STUDIO_ADMIN_PASSWORD: PW }, stdio: 'ignore' });
  try { for (let i = 0; i < 80; i++) { try { if ((await fetch(U + '/api/health')).ok) break; } catch {} await new Promise(z => setTimeout(z, 250)); }
    const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const p = await br.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(U + '/'); await p.fill('#auth input[name=username]', 'igor'); await p.fill('#auth input[name=password]', PW); await p.click('#auth button'); await p.waitForSelector('#app:not(.hidden)');
    for (const page of ['news', 'video']) { await p.evaluate(x => location.hash = x, page); await p.waitForFunction(() => /Рендер: (не )?готово/.test(document.body.textContent), null, { timeout: 30000 });
      const txt = await p.textContent('#app'); t(`UI ${label} ${page}: badge «Рендер: ${expectReady ? 'готово' : 'не готово'}»`, expectReady ? /Рендер: готово/.test(txt) && !/Рендер: не готово/.test(txt) : /Рендер: не готово/.test(txt));
      const msg = await p.$('[data-nv-deps-missing]'); t(`UI ${label} ${page}: missing-deps message ${expectReady ? 'absent' : 'shown with hint'}`, expectReady ? !msg : !!msg && /не найдено ffmpeg/.test(txt) && /brew install ffmpeg librsvg/.test(txt)); }
    const btns = await p.evaluate(() => { const h = nvDraftCard({ id: 'x', ref: 'r', status: 'approved', title: 't', stories: [], renders: [], history: [], factCheck: { required: true, checked: true } }); const el = document.createElement('div'); el.innerHTML = h; return [...el.querySelectorAll('[data-nv-render]')].map(b => b.disabled); }).catch(e => ['err:' + e.message]);
    t(`UI ${label}: render buttons ${expectReady ? 'enabled' : 'disabled'}`, btns.length === 2 && btns.every(x => x === !expectReady), JSON.stringify(btns));
    t(`UI ${label}: no JS errors`, !errs.length, errs.join('; ')); await br.close();
  } finally { s.kill('SIGTERM'); setTimeout(() => fs.rmSync(UD, { recursive: true, force: true }), 500); }
}
const NODEDIR = path.join(tmp, 'nodeonly'); fs.mkdirSync(NODEDIR); fs.symlinkSync(process.execPath, path.join(NODEDIR, 'node')); // never /usr/bin or /bin (they hold ffmpeg here)
await ui('missing', [EMPTY, NODEDIR].join(path.delimiter), '', false);
await ui('present', ORIG, '', true);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`); setTimeout(() => process.exit(fail ? 1 : 0), 700);
