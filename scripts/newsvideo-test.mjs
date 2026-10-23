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
  const cur = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j;
  t('draft flagged: fact-check required, not checked', cur.factCheck.required && !cur.factCheck.checked);
  t('per-sentence source links present', cur.stories[0].factCheck.sentences.length > 0 && cur.stories[0].factCheck.sentences.every(x => Array.isArray(x.sources) && x.sources.length));
  t('sourceItems (raw source text) not leaked to API', !('sourceItems' in cur.stories[0]));
  const nf = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { contentHash: cur.contentHash }); t('approve WITHOUT fact-check tick refused (422)', nf.s === 422 && nf.j.code === 'fact_check_required');
  const nh = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: 'stale' }); t('approve with stale content hash refused (409)', nh.s === 409 && nh.j.code === 'content_changed');
  const a = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: cur.contentHash }); t('approve writes episode JSON', a.j.status === 'approved' && fs.existsSync(path.join(dir, a.j.episodeFile)), a.j.error || a.j.episodeFile);
  const ep = JSON.parse(fs.readFileSync(path.join(dir, a.j.episodeFile))); t('episode schema for factory', ep.stories[0].text.startsWith('Owner') && fs.existsSync(ep.stories[0].asset.localPath) && ep.sources.length === 2);
  t('edit after approval resets to draft', (await call('PUT', `/api/newsvideo/drafts/${d.id}`, { title: 'Edited2' })).j.status === 'draft');
  { const c2 = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: c2.contentHash }); }
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
  // QA-NV-002: edit after render must stay «draft» (sync must not flip back), render must require re-approval of the CURRENT content.
  jobs.j0.artifacts = [{ kind: 'mp4', name: 'x.mp4', path: mp4, size: 7 }];
  let e2 = await call('PUT', `/api/newsvideo/drafts/${d.id}`, { stories: [{ id: rs.id, text: 'A newer owner text for the anchor.' }] }); t('edit after render → draft', e2.j.status === 'draft');
  g = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; t('QA-NV-002: GET after edit stays draft (sync does not flip to rendered)', g.status === 'draft', g.status);
  t('old render marked stale', g.staleRender === true && g.factCheck.checked === false);
  const rr = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' }); t('QA-NV-002: render without re-approval refused', rr.s === 409, rr.s + ' ' + rr.j.error);
  t('no job created for refused render', Object.keys(jobs).length === 1);
  const epFile = path.join(dir, g.episodeFile || `media/episodes/${d.ref}.json`); const ep1 = JSON.parse(fs.readFileSync(epFile));
  t('episode file still holds OLD approved text until re-approval', ep1.stories[0].text.startsWith('Owner'));
  const ap2 = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: g.contentHash }); t('re-approve current content', ap2.j.status === 'approved' && JSON.parse(fs.readFileSync(epFile)).stories[0].text.startsWith('A newer'));
  t('after re-approval status is approved (not stale rendered)', (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j.status === 'approved');
  // tamper: episode file content differs from approved hash → render refused
  const epj = JSON.parse(fs.readFileSync(epFile)); epj.contentHash = 'x'; fs.writeFileSync(epFile, JSON.stringify(epj));
  t('render refused when episode file hash mismatches', (await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'youtube' })).s === 409);
  epj.contentHash = g.contentHash; fs.writeFileSync(epFile, JSON.stringify(epj));
  const r2 = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'shorts' }); t('render after re-approval creates job bound to hash', r2.j.status === 'rendering' && r2.j.renders.at(-1).contentHash === g.contentHash);
  // fact-check flags
  const fc = NVmod.factCheck({ text: 'NASA tested the RS-25 engine at Stennis. Elon Musk attended the test with 40 guests.', sourceItems: [{ name: 'NASA', url: 'https://www.nasa.gov/a1', text: 'NASA tested the RS-25 engine at Stennis Space Center for 500 seconds.' }] });
  t('fact-check: supported sentence linked, no flags', fc.sentences[0].flags.length === 0 && fc.sentences[0].sources[0].url === 'https://www.nasa.gov/a1');
  t('fact-check: invented name + number flagged', fc.sentences[1].flags.some(f => /Elon Musk/.test(f)) && fc.sentences[1].flags.some(f => /40/.test(f)), JSON.stringify(fc.sentences[1].flags));
  // QA-NV-003: unload only own models
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { calls.push([String(u), o && o.body]); return { json: async () => ({ models: [{ name: 'fake' }, { name: 'prod-model:8b' }] }) }; };
  try { const u0 = await nv.unloadOwnModels('http://127.0.0.1:11434'); t('QA-NV-003: unloads only the model this flow used', JSON.stringify(u0.unloaded) === '["fake"]' && !calls.some(c => String(c[1]).includes('prod-model')), JSON.stringify(calls));
    calls.length = 0; const u1 = await nv.unloadOwnModels('http://127.0.0.1:11434'); t('QA-NV-003: nothing used since → no unload calls', u1.unloaded.length === 0 && calls.length === 0);
    let le = null; nv.usedModels.add('fake'); try { await nv.unloadOwnModels('http://10.0.0.5:11434'); } catch (x) { le = x; } t('QA-NV-003: non-loopback Ollama refused', le && /loopback/.test(le.message)); nv.usedModels.clear(); }
  finally { globalThis.fetch = realFetch; }
  // QA-NV-004: one generation at a time, cancel, quota
  let release; ollama = { ok: true }; const slow = runner.ollamaJson; runner.ollamaJson = (p, signal) => new Promise((res, rej) => { release = () => res({ json: { text: 'NASA tested the RS-25 engine for 500 seconds.' }, model: 'fake' }); signal && signal.addEventListener('abort', () => rej(signal.reason)); });
  const p1 = call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] }); await new Promise(z => setTimeout(z, 100));
  t('QA-NV-004: second concurrent draft refused (409)', (await call('POST', '/api/newsvideo/drafts', { storyIds: [rs.id] })).s === 409);
  const cx = await call('POST', '/api/newsvideo/drafts/cancel'); const r1 = await p1; t('QA-NV-004: cancel aborts generation', cx.j.cancelled && r1.s === 409 && /прервано/.test(r1.j.error), r1.s + ' ' + (r1.j && r1.j.error));
  const before = Object.keys((await call('GET', '/api/newsvideo/drafts')).j).length; runner.ollamaJson = slow;
  t('QA-NV-004: no draft saved after cancel', (await call('GET', '/api/newsvideo/drafts')).j.length === before);
  t('QA-NV-004: draft/render limits defined', NVmod.LIMITS.maxDrafts > 0 && NVmod.LIMITS.maxRendersPerDraft > 0 && NVmod.LIMITS.draftTimeoutMs > 0);
  // QA-NV-005: cap enforced while streaming without content-length
  let pulled = 0; const big = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024 * 1024)); if (pulled > 50) c.close(); } });
  let ce = null; try { await NVmod.readCapped(new Response(big), 3 * 1024 * 1024); } catch (x) { ce = x; } t('QA-NV-005: streaming cap without content-length', ce && /too large/.test(ce.message) && pulled <= 5, 'chunks read ' + pulled);
  t('QA-NV-005: small body read fully', (await NVmod.readCapped(new Response('hello'), 100)) === 'hello');
  // QA-NV-009: counters on a FRESH data dir
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nvtest2-')); const nv3 = NVmod({ app: express(), dataDir: dir2, services, runner, log() {}, fetchFn, now: () => now });
  const run1 = await nv3.search('igor'); const run2 = await nv3.search('igor');
  t('QA-NV-009: fresh dir → new = stories created, 0 duplicates', run1.new === nv3.engine.stories().length && run1.new > 0 && run1.duplicates === 0, JSON.stringify({ new: run1.new, merged: run1.merged, dup: run1.duplicates }));
  t('QA-NV-009: second run → 0 new, all duplicates', run2.new === 0 && run2.duplicates === run2.fetched, JSON.stringify({ new: run2.new, dup: run2.duplicates, fetched: run2.fetched }));
  fs.rmSync(dir2, { recursive: true, force: true });
  const nv2 = NVmod({ app: express(), dataDir: dir, services, runner, log() {}, fetchFn, now: () => now }); t('drafts persisted across restart', !!nv2.getDraft(d.id) && nv2.getDraft(d.id).history.length >= 5);
  const injected = await call('PUT', `/api/newsvideo/drafts/${d2.id}`, { title: 'Still a real draft', kind: 'demo', factChecked: true });
  t('real draft cannot be switched to demo', injected.s === 200 && injected.j.kind !== 'demo' && injected.j.factCheck.required === true && injected.j.factCheck.checked === false, injected.j.kind);
  const demo = await call('POST', '/api/newsvideo/demo', { preset: 'shorts', text: 'Pretend this is a real NASA result with 9999 engines.' });
  t('demo render queued from fixed fixture', demo.s === 200 && demo.j.kind === 'demo' && demo.j.status === 'rendering' && demo.j.factCheck.demo === true && demo.j.factCheck.checked === false && demo.j.factCheck.required === false, demo.j.error || demo.s);
  t('request body cannot replace demo script', demo.j.stories[0].text.includes('fictional demonstration') && !/9999/.test(JSON.stringify(demo.j.stories[0])));
  const dep = path.join(dir, demo.j.episodeFile); const depj = JSON.parse(fs.readFileSync(dep));
  t('demo episode is synthetic and not fact-checked', depj.demo === true && depj.factChecked === false && depj.synthetic === true && /ФАКТЫ НЕ ПРОВЕРЯЛИСЬ/.test(depj.formatTitle));
  const ad = await call('POST', `/api/newsvideo/drafts/${demo.j.id}/approve`, { factChecked: true, contentHash: demo.j.contentHash });
  t('demo cannot be approved', ad.s === 422 && ad.j.code === 'demo_not_approvable', ad.j.error);
  const ed = await call('PUT', `/api/newsvideo/drafts/${demo.j.id}`, { title: 'Now it is real' });
  t('demo cannot be edited into a release', ed.s === 422 && ed.j.code === 'demo_not_editable');
} catch (e) { fail++; console.error(e); } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
