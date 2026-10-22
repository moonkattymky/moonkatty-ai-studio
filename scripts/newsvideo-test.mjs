// Unit/integration test for lib/news-video.js (NEWS → VIDEO). No network: RSS comes from fixtures via injected fetchFn.
// Ollama and the render job service are test doubles here (the REAL chain is covered by scripts/newsvideo-e2e-real.mjs).
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http';
const require = createRequire(import.meta.url); const express = require('express'); const NVmod = require('../lib/news-video.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const now = new Date('2026-10-22T12:00:00Z'); const iso = h => new Date(now - h * 36e5).toUTCString();
const rss = items => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.map(i => `<item><title>${i.t}</title><link>${i.l}</link><description>${i.d}</description><pubDate>${i.p}</pubDate></item>`).join('')}</channel></rss>`;
const FEEDS = {
  nasa: rss([{ t: 'NASA Conducts RS-25 Engine Test at Stennis', l: 'https://www.nasa.gov/a1', d: 'NASA fired RS-25 engine for 500 seconds at Stennis Space Center.', p: iso(3) },
    { t: 'Future dated item', l: 'https://www.nasa.gov/a2', d: 'Item from the future.', p: new Date(+now + 72 * 36e5).toUTCString() }]),
  'bbc-science': rss([{ t: 'NASA conducts RS-25 engine test at Stennis center', l: 'https://www.bbc.co.uk/news/b1', d: 'The engine ran for 500 seconds in Mississippi, NASA said.', p: iso(2) }])
};
const fetchFn = async url => { const s = NVmod.SOURCES.find(x => x.url === url); if (!s) throw new Error('unexpected ' + url); if (s.id === 'npr-science') return { ok: false, status: 503, text: async () => '' };
  return { ok: true, status: 200, text: async () => FEEDS[s.id] || rss([]) }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvtest-')); const logs = []; const jobs = {};
let ollama = { ok: false }; let llmText = '';
const runner = { ollamaStatus: async () => ollama, ollamaJson: async () => ({ json: { text: llmText }, model: 'fake' }) };
const services = { videoRender: { hasExecutor: () => true }, jobsApi: { createJob: ({ input }) => { const id = 'j' + Object.keys(jobs).length; jobs[id] = { status: 'queued', input, artifacts: [] }; return { jobId: id }; }, getJob: id => jobs[id] } };
const app = express(); app.use(express.json()); app.use((req, res, next) => { req.user = 'igor'; next(); });
const nv = NVmod({ app, dataDir: dir, services, runner, log: (...a) => logs.push(a), fetchFn, now: () => now });
const srv = http.createServer(app).listen(0); const B = `http://127.0.0.1:${srv.address().port}`;
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
try {
  // safeFetch allowlist (real function, no network needed for rejected URLs)
  for (const u of ['http://www.nasa.gov/news-release/feed/', 'https://evil.example.com/rss', 'https://127.0.0.1/x', 'https://user:pw@www.nasa.gov/', 'https://www.nasa.gov:8443/']) {
    let e = null; try { await NVmod.safeFetch(u); } catch (x) { e = x; } t('safeFetch rejects ' + u, e && /not allowed/.test(e.message)); }
  const s = await call('POST', '/api/newsvideo/search'); t('search ok/partial', s.s === 200 && s.j.run.status === 'partial', s.j.run.status);
  t('search records per-source error', s.j.run.errors.some(e => e.source === 'npr-science'));
  t('search persisted in history', (await call('GET', '/api/newsvideo/stories')).j.runs.length === 1);
  const rs = s.j.candidates.find(c => /RS-25/.test(c.headline)); t('dedup merged NASA+BBC into one story', rs && rs.sources.length === 2, rs && rs.sources.length);
  t('verification confirmed (primary + independent)', rs.credibility.status === 'confirmed', rs.credibility.status);
  t('credibility high', rs.credibility.level === 'high', rs.credibility.score);
  const fut = s.j.candidates.find(c => /Future/.test(c.headline)); t('future date flagged', fut && fut.credibility.dateIssues.some(d => d.issue === 'future_date'));
  t('draft refused for invalid date', (await call('POST', '/api/newsvideo/drafts', { storyIds: [fut.id] })).s === 422);
  t('draft refused empty', (await call('POST', '/api/newsvideo/drafts', { storyIds: [] })).s === 400);
  t('draft refused unknown story', (await call('POST', '/api/newsvideo/drafts', { storyIds: ['nope'] })).s === 404);
  let d = (await call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] })).j; t('draft created, extractive fallback without Ollama', d.status === 'draft' && d.stories[0].provider === 'local-extractive' && /unavailable/.test(d.stories[0].fallbackReason));
  ollama = { ok: true }; llmText = 'NASA fired the engine for 9999 seconds.'; let d2 = (await call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] })).j;
  t('LLM text with invented number rejected → extractive', d2.stories[0].provider === 'local-extractive' && /9999/.test(d2.stories[0].fallbackReason));
  llmText = 'NASA tested its RS-25 engine for 500 seconds at Stennis.'; d2 = (await call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] })).j; t('LLM text accepted when numbers match sources', d2.stories[0].provider === 'ollama:fake');
  t('render before approval refused', (await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' })).s === 409);
  const e = await call('PUT', `/api/newsvideo/drafts/${d.id}`, { title: 'Edited', stories: [{ id: rs.id, text: 'Owner edited text for the anchor.' }] }); t('owner edit saved', e.j.title === 'Edited' && e.j.stories[0].text.startsWith('Owner') && e.j.stories[0].edited);
  t('edit with foreign story refused', (await call('PUT', `/api/newsvideo/drafts/${d.id}`, { stories: [{ id: 'x' }] })).s === 400);
  const a = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`); t('approve writes episode JSON', a.j.status === 'approved' && fs.existsSync(path.join(dir, a.j.episodeFile)), a.j.error || a.j.episodeFile);
  const ep = JSON.parse(fs.readFileSync(path.join(dir, a.j.episodeFile))); t('episode schema for factory', ep.stories[0].text.startsWith('Owner') && fs.existsSync(ep.stories[0].asset.localPath) && ep.sources.length === 2);
  t('edit after approval resets to draft', (await call('PUT', `/api/newsvideo/drafts/${d.id}`, { title: 'Edited2' })).j.status === 'draft');
  await call('POST', `/api/newsvideo/drafts/${d.id}/approve`);
  t('bad preset refused', (await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: '../x' })).s === 400);
  const r = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' }); t('render creates video_render job', r.j.status === 'rendering' && jobs.j0.input.episodeRef === d.ref && jobs.j0.input.runId === d.ref + '-r1');
  t('edit while rendering refused', (await call('PUT', `/api/newsvideo/drafts/${d.id}`, { title: 'x' })).s === 409);
  jobs.j0.status = 'failed'; jobs.j0.error = 'boom'; let g = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; t('job failure reflected + error persisted', g.status === 'render_failed' && g.renders[0].error === 'boom' && g.history.some(h => h.event === 'render_failed'));
  const mp4 = path.join(dir, 'media', 'x.mp4'); fs.writeFileSync(mp4, 'fakemp4'); jobs.j0.status = 'succeeded'; jobs.j0.error = null; jobs.j0.artifacts = [{ kind: 'mp4', name: 'x.mp4', path: mp4, size: 7 }];
  g = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; t('job success → rendered', g.status === 'rendered');
  const f = await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=mp4`); t('file served', f.status === 200 && (await f.text()) === 'fakemp4');
  t('file bad kind refused', (await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=../../etc/passwd`)).status === 400);
  t('traversal id refused', [400, 404].includes((await fetch(`${B}/api/newsvideo/drafts/..%2F..%2Fetc/file?kind=mp4`)).status));
  const out = path.join(dir, 'outside.mp4'); fs.writeFileSync(out, 'x'); jobs.j0.artifacts = [{ kind: 'mp4', path: out }]; t('artifact outside media root refused', (await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=mp4`)).status === 403);
  const nv2 = NVmod({ app: express(), dataDir: dir, services, runner, log() {}, fetchFn, now: () => now }); t('drafts persisted across restart', !!nv2.getDraft(d.id) && nv2.getDraft(d.id).history.length >= 5);
} catch (e) { fail++; console.error(e); } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
