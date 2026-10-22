// Tests for job type `video_render` (INTEGRATION.md §10): validation, idempotency dedupe, mutual exclusion with a
// blender_template job / Ollama via the global heavy lock, stub «Не подключено», artifact schema + workspace confinement.
// Usage: node scripts/video-render-test.mjs
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const require = createRequire(import.meta.url);
const T = '/tmp/mk-video-test'; fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T + '/ws/p_api', { recursive: true });
const { open } = require('../lib/db.js'); const db = open(T + '/t.db'); const jobs = require('../lib/jobs.js')(db);
const { withHeavy, status: heavy } = require('../lib/heavy-lock.js'); const VR = require('../lib/video-render.js');
const store = new Map(); const get = (c, id) => store.get(c + ':' + id); const put = (c, o) => { store.set(c + ':' + o.id, o); return o; };
let n = 0; const core = { uid: () => 'u' + (++n), now: () => new Date().toISOString() };
const gates = []; let vcount = 0;
const blender = { detect: async () => ({ ok: true, bin: '/fake/blender' }),
  runTemplate: (bin, t, mode, pf, vdir, o) => withHeavy('blender:' + mode, () => new Promise((res, rej) => gates.push(() => rej(new Error('fake blender done'))))) };
const ws = { newVersion: () => { const dir = `${T}/ws/p_api/v${++vcount}`; fs.mkdirSync(dir + '/logs', { recursive: true }); return { dir, version: vcount }; } };
const design3d = { cancelJob() {}, artifact() {} }; const runner = { start() {}, tick() {}, cancelTask() {} };
const MEDIA = T + '/media';
const S = require('../lib/services.js')({ jobs, design3d, runner, blender, ws, get, put, core, log() {}, mediaRoot: MEDIA }); const api = S.jobsApi;
const sleep = ms => new Promise(r => setTimeout(r, ms)); const res = []; const ok = (name, c, x = '') => { res.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + name + (x ? ' — ' + String(x).slice(0, 300) : '')); };
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
const until = async (f, ms = 3000) => { for (let i = 0; i < ms / 20; i++) { if (f()) return true; await sleep(20); } return false; };
const good = { runId: 'run_2026-10-21.a', preset: 'youtube', episodeRef: 's01/e03' };

// --- validation
ok('type registered with defaults gpu_heavy / mac-mini / safeToRetry', (d => d && d.resourceClass === 'gpu_heavy' && d.requiresNode === 'mac-mini' && d.safeToRetry === true)(S.TYPES.video_render));
for (const [name, inp] of [['unknown field', { ...good, extra: 1 }], ['unknown preset', { ...good, preset: 'tiktok' }], ['missing runId', { preset: 'youtube', episodeRef: 'e1' }],
  ['runId traversal', { ...good, runId: '../x' }], ['runId with slash', { ...good, runId: 'a/b' }], ['runId with space', { ...good, runId: 'a b' }], ['runId too long', { ...good, runId: 'a'.repeat(65) }],
  ['episodeRef traversal', { ...good, episodeRef: 's01/../../etc' }], ['episodeRef absolute', { ...good, episodeRef: '/etc/passwd' }], ['episodeRef shell chars', { ...good, episodeRef: 'e1;rm -rf' }],
  ['episodeRef non-string', { ...good, episodeRef: 5 }], ['episodeRef empty segment', { ...good, episodeRef: 's01//e1' }], ['input array', [1]], ['runId NUL', { ...good, runId: 'a\0b' }]])
  ok('reject: ' + name, throws(() => api.createJob({ type: 'video_render', input: inp }), /video_render/));
ok('reject resourceClass override', throws(() => api.createJob({ type: 'video_render', input: good, resourceClass: 'light' }), /gpu_heavy/));
ok('reject requiresNode override', throws(() => api.createJob({ type: 'video_render', input: good, requiresNode: 'other' }), /mac-mini/));
ok('reject idempotencyKey not <runId>:<preset>', throws(() => api.createJob({ type: 'video_render', input: good, idempotencyKey: 'x' }), /idempotencyKey/));
ok('no job rows created by rejected requests', jobs.list(500).length === 0);

// --- mutual exclusion with a blender_template job + stub
// v1.3.2-test: blender_template jobs are refused by the shared 3D gate (lib/feature-gate.js) → hold the lock with the Blender stub directly.
ok('blender_template job refused by 3D gate (feature_disabled), no row', throws(() => api.createJob({ type: 'blender_template', input: { template: 'scene_basic', params: {} } }), /3D-студия не одобрена/) && jobs.list(500).length === 0);
const btP = blender.runTemplate('/fake/blender', 'scene_basic', 'build').catch(() => {});
await until(() => heavy().holder && heavy().holder.startsWith('blender'));
ok('Blender (stub) holds the heavy lock', /^blender/.test(heavy().holder || ''), JSON.stringify(heavy()));
const v1 = api.createJob({ type: 'video_render', input: good });
const j1 = api.getJob(v1.jobId);
ok('video_render job fields: key <runId>:<preset>, gpu_heavy, mac-mini, safeToRetry', j1.idempotencyKey === 'run_2026-10-21.a:youtube' && j1.resourceClass === 'gpu_heavy' && j1.requiresNode === 'mac-mini' && j1.safeToRetry === true, JSON.stringify(j1));
ok('input stored exactly (no extra fields)', JSON.stringify(jobs.get(v1.jobId).input) === JSON.stringify(good));
const v1b = api.createJob({ type: 'video_render', input: { ...good } });
ok('idempotency: same runId+preset → same jobId, existing:true', v1b.jobId === v1.jobId && v1b.existing === true);
const v1c = api.createJob({ type: 'video_render', input: good, idempotencyKey: 'run_2026-10-21.a:youtube' });
ok('idempotency: explicit matching key also dedupes', v1c.jobId === v1.jobId && v1c.existing === true);
const v2 = api.createJob({ type: 'video_render', input: { ...good, preset: 'shorts' } });
ok('different preset → new job', v2.jobId && v2.jobId !== v1.jobId && !v2.existing);
await sleep(150);
ok('video_render stays queued while Blender runs (no overlap)', api.getJob(v1.jobId).internalStatus === 'queued' && api.getJob(v2.jobId).internalStatus === 'queued', api.getJob(v1.jobId).internalStatus);
ok('two video_render jobs waiting behind the lock', heavy().waiting >= 2, JSON.stringify(heavy()));
gates.shift()();   // finish the Blender job → lock passes FIFO to the queued video_render jobs
await until(() => ['failed', 'done'].includes(api.getJob(v2.jobId).internalStatus));
const f1 = api.getJob(v1.jobId);
ok('stub: job failed with «Не подключено», no artifacts', f1.status === 'failed' && /Не подключено/.test(f1.error) && f1.artifacts.length === 0, JSON.stringify(f1));
ok('stub: no output files created', !fs.existsSync(MEDIA) || fs.readdirSync(MEDIA).length === 0);
await btP;

// --- strict serialization: plug a slow executor, measure overlap with blender + ollama + each other
let active = 0, maxActive = 0; const log = [];
const tracked = (tag, ms) => async () => { active++; maxActive = Math.max(maxActive, active); log.push('+' + tag); await sleep(ms); log.push('-' + tag); active--; };
const mk = (dir, kind, ext, body) => { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, kind + '.' + ext); fs.writeFileSync(p, body); return { path: p, size: fs.statSync(p).size, sha256: crypto.createHash('sha256').update(body).digest('hex'), kind }; };
VR.setExecutor(async ({ runId, preset, outDir }) => { await tracked('video', 60)(); const d = path.join(outDir, runId, preset);
  return { artifacts: [mk(d, 'mp4', 'mp4', 'MP4DATA'), mk(d, 'srt', 'srt', '1\n00:00:00,000 --> 00:00:01,000\nhi\n'), mk(d, 'jpg', 'jpg', 'JPGDATA')] }; });
const pOll = withHeavy('ollama', tracked('ollama', 40));
const pa = api.createJob({ type: 'video_render', input: { runId: 'r2', preset: 'youtube', episodeRef: 'e1' } });
const pb = api.createJob({ type: 'video_render', input: { runId: 'r3', preset: 'shorts', episodeRef: 'e2' } });
const pBl = withHeavy('blender:render', tracked('blender', 40));
await Promise.all([pOll, pBl]); await until(() => ['done', 'failed'].includes(api.getJob(pb.jobId).internalStatus));
ok('never more than one heavy job active (video/video/blender/ollama)', maxActive === 1, log.join(' '));
const da = api.getJob(pa.jobId);
ok('plugged executor: job succeeded', da.status === 'succeeded', da.error);
ok('artifact schema: mp4+srt+jpg each {path,size,sha256,kind}', da.artifacts.length === 3 && ['mp4', 'srt', 'jpg'].every(k => da.artifacts.some(a => a.kind === k && a.path.startsWith(MEDIA + '/') && Number.isInteger(a.size) && /^[0-9a-f]{64}$/.test(a.sha256))), JSON.stringify(da.artifacts));

// --- artifact schema rejects
const d0 = MEDIA + '/chk'; const A = [mk(d0, 'mp4', 'mp4', 'M'), mk(d0, 'srt', 'srt', 'S'), mk(d0, 'jpg', 'jpg', 'J')];
ok('validateArtifacts accepts good set', VR.validateArtifacts(A, MEDIA).ok);
fs.mkdirSync(T + '/out', { recursive: true }); fs.writeFileSync(T + '/out/x.mp4', 'M');
ok('reject path outside workspace', !VR.validateArtifacts([{ ...A[0], path: T + '/out/x.mp4' }, A[1], A[2]], MEDIA).ok);
ok('reject ../ traversal path', !VR.validateArtifacts([{ ...A[0], path: MEDIA + '/../out/x.mp4' }, A[1], A[2]], MEDIA).ok);
fs.symlinkSync(T + '/out', MEDIA + '/link'); ok('reject symlink escaping workspace', !VR.validateArtifacts([{ ...A[0], path: MEDIA + '/link/x.mp4' }, A[1], A[2]], MEDIA).ok);
ok('reject wrong sha256', !VR.validateArtifacts([{ ...A[0], sha256: 'a'.repeat(64) }, A[1], A[2]], MEDIA).ok);
ok('reject wrong size', !VR.validateArtifacts([{ ...A[0], size: 99 }, A[1], A[2]], MEDIA).ok);
ok('reject missing cover jpg', !VR.validateArtifacts([A[0], A[1]], MEDIA).ok);
ok('reject duplicate mp4', !VR.validateArtifacts([A[0], A[0], A[1], A[2]], MEDIA).ok);
ok('reject unknown kind (png)', !VR.validateArtifacts([A[0], A[1], { ...A[2], kind: 'png' }], MEDIA).ok);
ok('reject kind/extension mismatch', !VR.validateArtifacts([{ ...A[0], kind: 'jpg' }, A[1], { ...A[2], kind: 'mp4' }], MEDIA).ok);
ok('reject unknown artifact field', !VR.validateArtifacts([{ ...A[0], url: 'http://x' }, A[1], A[2]], MEDIA).ok);
VR.setExecutor(async ({ outDir }) => ({ artifacts: [{ path: '/etc/hostname', size: 1, sha256: 'a'.repeat(64), kind: 'mp4' }] }));
const bad = api.createJob({ type: 'video_render', input: { runId: 'r4', preset: 'youtube', episodeRef: 'e1' } });
await until(() => api.getJob(bad.jobId).internalStatus === 'failed');
ok('executor returning out-of-workspace artifact → job failed, artifacts not stored', api.getJob(bad.jobId).artifacts.length === 0 && /неверный результат/.test(api.getJob(bad.jobId).error));
VR.setExecutor(null); ok('setExecutor(null) restores stub', VR.isStub());
const passed = res.filter(Boolean).length; console.log(`\n${passed}/${res.length} passed`); process.exit(passed === res.length ? 0 : 1);
