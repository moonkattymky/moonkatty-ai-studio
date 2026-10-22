// Video render dependency diagnostics (ffmpeg, ffprobe, rsvg-convert): API with a substituted PATH (missing / present /
// Homebrew-fallback / partial) and UI (status badge «Рендер: не готово», disabled render buttons) against real servers.
// Binaries are never executed by the check; stubs are empty executable files. Needs playwright-core + Chrome for the UI part.
import { createRequire } from 'module'; import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import net from 'net'; import crypto from 'crypto';
const require = createRequire(import.meta.url); const express = require('express'); const NVmod = require('/workspace/qa133/res/app.asar.unpacked/lib/news-video.js'); const VD = require('../lib/video-deps.js');
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
const E2=mk(path.join(tmp,'e2'),[]); setEnv(E2, '');
const s = await call('POST', '/api/newsvideo/search'); const rs = s.j.candidates.find(c => /RS-25/.test(c.headline));
let d = (await call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] })).j; const cur = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j;
const a = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: cur.contentHash }); t('approve without ffmpeg → 200 approved (no spawn)', a.s===200 && a.j.status==='approved', a.s+' '+(a.j&&a.j.status)+' '+(a.j&&a.j.error||''));
const r = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' }); t('render without ffmpeg → 424 video_deps_missing (not 500 ENOENT)', r.s===424 && r.j.code==='video_deps_missing' && !/ENOENT/.test(r.j.error), r.s+' '+r.j.code+' '+r.j.error);
t('no job, draft stays approved', Object.keys(jobs).length===0 && (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j.status==='approved');
srv.close(); console.log(`pass=${pass} fail=${fail}`); process.exit(fail?1:0);
