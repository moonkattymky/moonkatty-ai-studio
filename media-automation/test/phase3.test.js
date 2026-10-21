'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const crypto = require('crypto');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ma-p3-'));
const { classify, attributionLine, licenseUrl } = require('../src/media/licenses');
const { layoutFor, relevant } = require('../src/media/library');
const { applyLexicon, parseMarkup, stripMarkup } = require('../src/video/speech');
const { MasterVoice } = require('../src/video/master-voice');
const { YouTubeOAuth, pkce } = require('../src/auth/youtube-oauth');
const { setupTelegram } = require('../src/auth/telegram-setup');
const { MemorySecrets, ChainSecrets } = require('../src/secrets');
const { visemeTimeline, toViseme, buildRequestV2, QueuedHost3DV2 } = require('../src/host3d');
const { anchorLines, detectMajorEvent, applyMajorEventPolicy, CorrectionsDesk } = require('../src/editorial');
const { ApprovalCenter } = require('../src/approval/center');
const { pickFact, mediaQueries } = require('../src/orchestrator/facts');
const { Scheduler, NEWS_PLANS } = require('../src/schedule/scheduler');
const res = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });

test('licenses: allow PD/CC0/CC-BY/CC-BY-SA-IGO/NASA, reject NC/ND/unknown/fair use', () => {
  for (const [raw, id] of [['CC0', 'CC0-1.0'], ['Public domain', 'Public-Domain'], ['CC BY 4.0', 'CC-BY-4.0'], ['CC BY-SA 3.0 IGO', 'CC-BY-SA-3.0-IGO'], ['cc-by-sa-4.0', 'CC-BY-SA-4.0']]) assert.equal(classify(raw).id, id, raw);
  assert.equal(classify('', { source: 'nasa' }).id, 'NASA-media');
  for (const raw of ['CC BY-NC 4.0', 'CC BY-ND 2.0', '', 'Fair use', 'All rights reserved', 'weird custom']) assert.equal(classify(raw).ok, false, raw);
  assert.match(licenseUrl('CC-BY-SA-3.0-IGO'), /igo/); assert.match(attributionLine({ author: 'ESA', license: 'CC-BY-SA-3.0-IGO', title: 'X', kind: 'image' }), /ESA.*CC-BY-SA-3.0-IGO/);
});
test('layoutFor never upscales: kenburns / blurfill / reject', () => {
  assert.equal(layoutFor({ width: 4000, height: 3000 }, 1920, 1080).mode, 'kenburns');
  const b = layoutFor({ width: 1600, height: 1200 }, 1920, 1080); assert.equal(b.mode, 'blurfill'); assert.ok(b.fgWidth <= 1600 && b.fgHeight <= 1200);
  assert.equal(layoutFor({ width: 300, height: 200 }, 1920, 1080).mode, 'reject');
});
test('relevance filter requires query terms in metadata', () => {
  assert.equal(relevant('Webb Jets Protostar', { title: 'Webb image of protostar jets' }), true);
  assert.equal(relevant('Webb Jets Protostar', { title: 'Astronaut portrait' }), false);
});
test('speech: lexicon + pause markup', () => {
  assert.equal(applyLexicon('ESA and MOONKATTY', { ESA: 'E.S.A.', MOONKATTY: 'Moon Katty' }), 'E.S.A. and Moon Katty');
  assert.deepEqual(parseMarkup('Hi. [pause 600] Next'), [{ text: 'Hi.' }, { pauseMs: 600 }, { text: 'Next' }]);
  assert.equal(stripMarkup('Hi. [pause 600] Next').replace(/\s+/g, ' '), 'Hi. Next');
});
test('master voice: pinned hash, male only, lock/unlock audit, no substitution, lip-sync export', () => {
  const d = tmp(); const model = path.join(d, 'm.onnx'), voices = path.join(d, 'v.bin'); fs.writeFileSync(model, 'model-a'); fs.writeFileSync(voices, 'v');
  const sha = crypto.createHash('sha256').update('model-a').digest('hex'); const f = path.join(d, 'mv.json');
  fs.writeFileSync(f, JSON.stringify({ status: 'candidate', engine: 'kokoro', voice: 'am_michael', gender: 'male', rate: 0.95, voiceProfileId: 'vp-1', model: { file: model, sha256: sha }, voicesFile: voices }));
  const mv = new MasterVoice({ file: f, env: {} }); assert.equal(mv.createTTS().name.startsWith('kokoro'), true);
  assert.throws(() => mv.lock(), /owner/); mv.lock('Igor'); assert.equal(new MasterVoice({ file: f }).locked, true);
  assert.throws(() => mv.setCandidate({ voice: 'af_bella' }, 'x'), /locked/);
  assert.equal(mv.exportForLipSync().voiceProfileId, 'vp-1');
  fs.writeFileSync(model, 'model-b'); fs.utimesSync(model, new Date(), new Date(Date.now() + 5000)); assert.throws(() => new MasterVoice({ file: f, env: {} }).createTTS(), /hash mismatch/);
  fs.unlinkSync(model); assert.throws(() => new MasterVoice({ file: f, env: {} }).createTTS(), /unavailable/);
  mv.unlock('Igor', 'retest'); assert.equal(mv.cfg.audit.length, 1);
  const g = JSON.parse(fs.readFileSync(f)); g.gender = 'female'; fs.writeFileSync(f, JSON.stringify(g)); assert.throws(() => new MasterVoice({ file: f, env: {} }).createTTS(), /male/);
});
test('repo master voice config: male, locked by owner (B blend), autoReplace false, voiceProfileId field present', () => {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'master-voice.json')));
  assert.equal(c.gender, 'male'); assert.match(c.model.sha256, /^[0-9a-f]{64}$/); assert.ok('voiceProfileId' in c); assert.equal(c.status, 'locked'); assert.equal(c.autoReplace, false); assert.equal(c.approvedBy, 'Igor'); assert.deepEqual(c.blend, { am_puck: 0.6, am_michael: 0.4 }); assert.equal(c.speed, 1.06); assert.equal(c.pitchSemitones, 0.4); assert.match(c.voicesSha256, /^[0-9a-f]{64}$/);
});
test('pkce S256', () => { const p = pkce(); assert.equal(p.challenge, crypto.createHash('sha256').update(p.verifier).digest('base64url')); assert.ok(p.verifier.length >= 43); });
test('YouTube OAuth loopback: state check, PKCE exchange, refresh token stored per channel, refresh + invalid_grant', async () => {
  const secrets = new ChainSecrets([new MemorySecrets({ youtube_oauth_client: JSON.stringify({ client_id: 'cid' }) })]); const calls = [];
  const fetchFn = async (url, o) => { const p = Object.fromEntries(new URLSearchParams(o.body)); calls.push(p);
    if (p.grant_type === 'authorization_code') return res(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 's' });
    if (p.refresh_token === 'rt1') return res(200, { access_token: 'at2', expires_in: 3600 }); return res(400, { error: 'invalid_grant' }); };
  let now = 0; const o = new YouTubeOAuth({ secrets, fetchFn, now: () => now });
  await assert.rejects(o.authorize('youtube-other', { onUrl() {} }), /account/);
  const r = await o.authorize('youtube-news', { onUrl: url => { const u = new URL(url); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const cb = new URL(u.searchParams.get('redirect_uri')); assert.equal(cb.hostname, '127.0.0.1'); cb.searchParams.set('code', 'C'); cb.searchParams.set('state', u.searchParams.get('state')); http.get(cb, x => x.resume()); } });
  assert.equal(r.account, 'youtube-news'); assert.equal(await secrets.get('youtube_news_refresh_token'), 'rt1'); assert.ok(calls[0].code_verifier);
  assert.equal(await o.accessToken('youtube-news'), 'at1'); now = 4e6; assert.equal(await o.accessToken('youtube-news'), 'at2');
  await assert.rejects(o.accessToken('youtube-project'), /not authorized/);
  await secrets.set('youtube_project_refresh_token', 'bad'); await assert.rejects(o.accessToken('youtube-project'), /revoked/);
  await assert.rejects(o.authorize('youtube-project', { timeoutMs: 2000, onUrl: url => { const u = new URL(url); const cb = new URL(u.searchParams.get('redirect_uri')); cb.searchParams.set('code', 'C'); cb.searchParams.set('state', 'forged'); http.get(cb, x => x.resume()); } }), /state mismatch/);
});
test('Telegram setup: format, getMe, channel admin check, stored in secrets (mocked API)', async () => {
  const secrets = new MemorySecrets(); const tok = '123456:' + 'A'.repeat(35);
  await assert.rejects(setupTelegram({ token: 'nope', secrets }), /format/);
  const fetchFn = async url => { const m = url.split('/').pop().split('?')[0];
    return res(200, { ok: true, result: m === 'getMe' ? { id: 9, is_bot: true, username: 'mk_bot' } : m === 'getChat' ? { id: -100, title: 'MK', type: 'channel' } : { status: 'administrator' } }); };
  const r = await setupTelegram({ token: tok, channel: '@mk', secrets, fetchFn }); assert.equal(r.canPost, true); assert.equal(await secrets.get('telegram_bot_token'), tok);
  await assert.rejects(setupTelegram({ token: tok, secrets: new MemorySecrets(), fetchFn: async () => res(401, { ok: false, description: 'Unauthorized' }) }), /Unauthorized/);
});
test('visemes: IPA mapping and timeline covers duration', async () => {
  assert.equal(toViseme('p'), 'PP'); assert.equal(toViseme('f'), 'FF'); assert.equal(toViseme('oʊ'), 'O'); assert.equal(toViseme('s'), 'SS');
  const runFn = async () => ({ stdout: 'h_ə_l_ˈoʊ w_ˈɜː_l_d\n' }); const v = await visemeTimeline('hello world', 2, { runFn });
  assert.equal(v[0].viseme, 'sil'); const last = v[v.length - 1]; assert.ok(Math.abs(last.t + last.d - 2) < 0.02); assert.ok(v.some(x => x.viseme === 'O'));
  for (let i = 1; i < v.length; i++) assert.ok(v[i].t >= v[i - 1].t);
});
test('host3d v2 request: pinned model, cues, costume; enqueued as render_segment', async () => {
  assert.throws(() => buildRequestV2({ script: 'x' }), /modelVersion/);
  const req = buildRequestV2({ script: 's', audioPath: 'a.wav', durationSec: 5, aspect: '16:9', outPath: 'o.mov', visemes: [], story: { breaking: true }, modelVersion: 'cat@1.4.2' });
  assert.equal(req.character.id, 'moonkatty-master-cat'); assert.equal(req.cues[1].emotion, 'serious');
  let job; const h = new QueuedHost3DV2({ jobQueue: { runExclusive: async j => { job = j; return { videoPath: '/v.mov' }; } }, modelVersion: 'cat@1.4.2', voice: { voiceProfileId: 'vp' } });
  assert.deepEqual(await h.renderSegment({ script: 's', audioPath: 'a', durationSec: 3, aspect: '9:16', outPath: 'o', visemes: [] }), { videoPath: '/v.mov' });
  assert.equal(job.type, 'render_segment'); assert.equal(job.input.voice.voiceProfileId, 'vp');
});
test('editorial: anchor lines, major-event pause, corrections via ports and approval', async () => {
  assert.match(anchorLines({ daypart: 'morning' }).opening, /Good morning/); assert.match(anchorLines({ breaking: true }).opening, /breaking/);
  const d = tmp(); const sch = new Scheduler({ statePath: path.join(d, 's.json') });
  const big = { id: 'b', headline: 'Big', breaking: true, corroboration: 'confirmed', verification: { independentOrigins: 3 } };
  assert.equal(detectMajorEvent([{ ...big, verification: { independentOrigins: 1 } }]).length, 0);
  applyMajorEventPolicy({ stories: [big], scheduler: sch }); assert.equal(sch.settings().paused, true); assert.match(sch.settings().pausedReason, /major event/);
  const logged = []; const approval = new ApprovalCenter({ statePath: path.join(d, 'a.json') });
  const desk = new CorrectionsDesk({ statePath: path.join(d, 'c.json'), approval, logPort: { append: async e => logged.push(e) }, verifier: { verifyCorrection: async () => ({ verdict: 'confirmed_error', verifiedBy: 'studio4' }) } });
  const c = await desk.report({ episodeId: 'ep1', claim: 'wrong distance', reportedBy: 'viewer' });
  await assert.rejects(desk.draft(c.id, { text: 'x' }), /confirmed/); await desk.verify(c.id); await desk.draft(c.id, { text: 'Correction: the distance is 3 km.' });
  const it = approval.get(`correction-${c.id}`); assert.equal(it.status, 'pending'); assert.deepEqual(logged.map(e => e.type), ['correction_reported', 'correction_verified', 'correction_drafted']);
});
test('approval center: edit title+description with validation; publish status', () => {
  const a = new ApprovalCenter({ statePath: path.join(tmp(), 'a.json') }); a.submit({ id: 'v1', title: 'T', description: 'D' });
  a.edit('v1', { title: 'New title', description: 'New desc' }, 'Igor'); assert.equal(a.get('v1').title, 'New title'); assert.equal(a.get('v1').description, 'New desc');
  assert.throws(() => a.edit('v1', { title: 'x'.repeat(101) }, 'Igor'), /title/); a.setPublishStatus('v1', { status: 'dry_run_done' }); assert.equal(a.get('v1').publish.status, 'dry_run_done');
});
test('facts: numbers only from source text; media queries', () => {
  assert.deepEqual(pickFact([{ title: 'Probe flies 2,500 km above moon', sourceName: 'ESA' }]).value, '2,500'); assert.equal(pickFact([{ title: 'In 2026 things happened' }]), null);
  const q = mediaQueries({ headline: 'NASA Webb reveals protostar jets', category: 'space' }); assert.equal(q[0].provider, 'nasa');
});
test('news schedule plans: 09:00 & 19:00 video, daytime text, Asia/Jerusalem', () => {
  assert.deepEqual(NEWS_PLANS.filter(p => p.action === 'news_video_issue').flatMap(p => p.times), ['09:00', '19:00']); assert.ok(NEWS_PLANS.every(p => p.tz === 'Asia/Jerusalem'));
});
test('studio adapter aligned with v1.2.0 JOBS_API: extra fields, status/id normalization, render_segment failed stub -> null', async () => {
  const { StudioJobQueueAdapter, StudioHost3D } = require('../src/jobs/studio-adapter'); let created;
  const client = { createJob: async b => { created = b; return { jobId: 'job_1' }; }, getJob: async () => ({ id: 'job_1', status: 'done', artifacts: [{ path: '/x/seg.mov' }] }), cancelJob: async () => ({}), listJobs: async () => [] };
  const a = new StudioJobQueueAdapter({ client, pollMs: 1 });
  const r = await a.runExclusive({ type: 'blender_template', input: { template: 'scene_basic' }, idempotencyKey: 'k', resourceClass: 'gpu_heavy' });
  assert.equal(created.idempotencyKey, 'k'); assert.equal(created.resourceClass, 'gpu_heavy'); assert.equal(r.videoPath, '/x/seg.mov');
  assert.equal((await a.getJob('job_1')).status, 'succeeded');
  const stub = new StudioJobQueueAdapter({ client: { ...client, getJob: async () => ({ jobId: 'job_2', status: 'failed', error: 'не реализовано' }) }, pollMs: 1 });
  assert.equal(await new StudioHost3D({ adapter: stub }).renderSegment({ script: 's' }), null);
  assert.equal(await new StudioHost3D({ adapter: new StudioJobQueueAdapter() }).renderSegment({}), null);
});
test('relevance: proper noun must match (no opera image for BepiColombo)', () => {
  assert.equal(relevant('Celebrating BepiColombo three words', { title: 'Lakmé - opera in three acts - music; words by Gondinet' }), false);
  assert.equal(relevant('Schiaparelli Crater Mars', { title: 'Jezero Crater as Seen by Mars Express' }), false);
  assert.equal(relevant('BepiColombo Mercury', { title: 'BepiColombo approaching Mercury' }), true);
});
test('panel fallback: own-work branded panel registered with rights, no stock image', async () => {
  const { MediaLibrary } = require('../src/media/library'); const { panelFallbackFactory, panelSvg } = require('../src/media/panel'); const d = tmp();
  const lib = new MediaLibrary({ dir: d, providers: {} });
  assert.match(panelSvg({ headline: 'A & B', category: 'space', showHeadline: true }), /A &amp; B/); assert.doesNotMatch(panelSvg({ headline: 'A & B', category: 'space' }), /A &amp; B/); // no duplicate headline on panel
  const mk = panelFallbackFactory({ library: lib, dir: d, runFn: async (cmd, args) => { fs.writeFileSync(args[1], 'png'); return { stdout: '' }; } });
  const a = await mk({ story: { id: 's1', category: 'space' }, headline: 'Shock analysis', fact: null });
  assert.equal(a.license, 'Own-work'); assert.ok(fs.existsSync(a.localPath)); assert.equal(lib.rightsReport([a.id]).assets[0].provider, 'moonkatty-generated');
});
test('media queries never consist of generic words only when the headline has proper nouns', () => {
  const q = mediaQueries({ headline: 'Mars’s oddest cloud may be even odder than we thought', category: 'space' });
  assert.ok(q.length && q.every(x => /Mars/.test(x.q)), JSON.stringify(q));
});
test('verify: confirmed needs primary + corroboration; media-only -> unconfirmed; primary alone -> primary_only', () => {
  const { verifyStory } = require('../src/news/verify'); const now = new Date('2026-10-21T00:00:00Z');
  const it = (sourceId, title, extra = {}) => ({ sourceId, title, summary: title + ' ' + sourceId + ' independent wording here', published: '2026-10-20T20:00:00Z', ...extra });
  const sources = { a: { owner: 'A' }, b: { owner: 'B' }, gov: { primary: true, owner: 'GOV' } };
  assert.equal(verifyStory([it('a', 'Quake hits'), it('b', 'Earthquake strikes')], { now, sources }).status, 'unconfirmed');
  assert.ok(verifyStory([it('a', 'Quake hits'), it('b', 'Earthquake strikes')], { now, sources }).reasons.includes('no_primary_source'));
  assert.equal(verifyStory([it('gov', 'Ministry statement')], { now, sources }).status, 'primary_only');
  assert.equal(verifyStory([it('gov', 'Ministry statement'), it('a', 'Ministry says')], { now, sources }).status, 'confirmed');
  assert.equal(verifyStory([it('a', 'X', { primarySourceUrl: 'https://gov.example/x' }), it('b', 'Y')], { now, sources }).status, 'confirmed');
});
test('license: UK OGL v3 accepted with attribution; other OGL versions rejected', () => {
  const r = classify('Open Government Licence v3.0'); assert.equal(r.id, 'OGL-UK-3.0'); assert.equal(r.attributionRequired, true);
  assert.equal(classify('OGL v2').ok, false); assert.match(licenseUrl('OGL-UK-3.0'), /version\/3/);
});
test('orchestrator render queue: studio queue without video_render -> local fallback', () => {
  const { Orchestrator } = require('../src/orchestrator/orchestrator'); const { StudioJobQueueAdapter } = require('../src/jobs/studio-adapter');
  const local = { runExclusive() {} }; const o = new Orchestrator({ stateDir: tmp(), jobQueue: new StudioJobQueueAdapter(), fallbackQueue: local });
  assert.equal(o._renderQueue(), local); assert.throws(() => new Orchestrator({ stateDir: tmp(), jobQueue: new StudioJobQueueAdapter() })._renderQueue(), /fallbackQueue/);
  assert.equal(require('../src/video/presets').getPreset('youtube').targetLufs, -16);
});
test('video_render executor matches Studio a991e93 contract (shape, kinds, sha256, paths in <dataDir>/media, Ollama unload, strict input)', async () => {
  const { createVideoRenderExecutor, writeEpisode } = require('../src/jobs/video-render-executor'); const dataDir = tmp(); const calls = [];
  writeEpisode(dataDir, 'ep-1', { title: 'T', stories: [] });
  const factory = { render: async (ep, { preset, outDir, basename }) => { calls.push('render'); const f = e => path.join(outDir, `${basename}.${e}`); for (const e of ['mp4', 'srt', 'jpg']) fs.writeFileSync(f(e), e + preset);
    return { files: { video: f('mp4'), subtitles: f('srt'), thumbnail: f('jpg') } }; } };
  const exec = createVideoRenderExecutor({ dataDir, factory, llm: { unload: async () => calls.push('unload') } });
  const { artifacts, ...rest } = await exec({ runId: 'ep-1', preset: 'shorts', episodeRef: 'ep-1', jobId: 'job_x', outDir: path.join(dataDir, 'media') });
  assert.deepEqual(Object.keys(rest), []); assert.deepEqual(calls, ['unload', 'render']);
  assert.deepEqual(artifacts.map(a => a.kind).sort(), ['jpg', 'mp4', 'srt']);
  const root = fs.realpathSync(path.join(dataDir, 'media'));
  for (const a of artifacts) { assert.deepEqual(Object.keys(a).sort(), ['kind', 'name', 'path', 'sha256', 'size']); assert.ok(path.isAbsolute(a.path) && a.path.startsWith(root + path.sep));
    assert.ok(a.path.endsWith('.' + a.kind)); assert.equal(a.size, fs.statSync(a.path).size); assert.equal(a.sha256, crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')); }
  await assert.rejects(exec({ runId: 'ep-1', preset: 'shorts', episodeRef: 'ep-1', extra: 1 }), /unknown input/);
  await assert.rejects(exec({ runId: '../x', preset: 'shorts', episodeRef: 'ep-1' }), /runId/);
  await assert.rejects(exec({ runId: 'ep-1', preset: 'tv', episodeRef: 'ep-1' }), /preset/);
  await assert.rejects(exec({ runId: 'ep-1', preset: 'youtube', episodeRef: 'a/../b' }), /episodeRef/);
  await assert.rejects(exec({ runId: 'ep-1', preset: 'youtube', episodeRef: 'ep-1', outDir: tmp() }), /inside/);
});
test('studio adapter lists video_render only when executor registered; orchestrator uses strict input', async () => {
  const { StudioJobQueueAdapter } = require('../src/jobs/studio-adapter'); const { Orchestrator } = require('../src/orchestrator/orchestrator');
  const vr = { executor: null, hasExecutor() { return !!this.executor; } };
  let created; const client = { createJob: async b => { created = b; return { jobId: 'j' }; }, getJob: async () => ({ id: 'j', status: 'done', artifacts: [{ kind: 'mp4', path: mp4 }] }), cancelJob: async () => ({}), listJobs: async () => [] };
  const a = new StudioJobQueueAdapter({ client, videoRender: vr, pollMs: 1 }); assert.ok(!a.supportedTypes.includes('video_render'));
  const local = { runExclusive: async () => ({ local: true }) }; const o = new Orchestrator({ stateDir: tmp(), jobQueue: a, fallbackQueue: local, studioDataDir: tmp() });
  assert.equal(o._renderQueue(), local);
  vr.executor = () => {}; assert.ok(a.supportedTypes.includes('video_render')); assert.equal(o._renderQueue(), a);
  const d = tmp(); var mp4 = path.join(d, 'r-youtube.mp4'); fs.writeFileSync(mp4, 'x'); fs.writeFileSync(mp4.replace('.mp4', '.json'), JSON.stringify({ qa: { ok: true } }));
  const r = await a.runExclusive({ type: 'video_render', input: { runId: 'r', preset: 'youtube', episodeRef: 'r' }, resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true });
  assert.deepEqual(Object.keys(created.input), ['runId', 'preset', 'episodeRef']); assert.equal(created.idempotencyKey, undefined); assert.equal(r.videoPath, mp4);
});
