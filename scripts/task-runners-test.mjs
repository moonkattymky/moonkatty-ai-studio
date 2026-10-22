// Real-command tests for opencode_task / render_segment runners (lib/task-runners.js via lib/services.js).
// Uses the real job engine (node:sqlite) and real ffmpeg. Usage: node scripts/task-runners-test.mjs (Node >= 22.5)
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';
const require = createRequire(import.meta.url); process.env.STUDIO_SQLITE = 'node';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tr-')); const db = require('../lib/db.js').open(path.join(TMP, 'db.sqlite'));
const jobs = require('../lib/jobs.js')(db); const blender = require('../lib/blender.js')();
const store = {}; let n = 0; const core = { uid: () => 'u' + (++n), now: () => new Date().toISOString() };
const get = (c, id) => (store[c] || {})[id], put = (c, o) => ((store[c] = store[c] || {})[o.id] = o, o);
const S = require('../lib/services.js')({ jobs, design3d: { cancelJob() {}, artifact: (d, f) => ({ path: path.join(d, f) }) }, runner: { cancelTask() {}, tick() {}, start() {} }, blender, ws: require('../lib/workspace.js')(TMP), get, put, core, log() {}, mediaRoot: path.join(TMP, 'media') });
let fail = 0; const ok = (name, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + name + (x ? ' — ' + x : '')); if (!c) fail++; };
const wait = async (id, ms = 60000) => { const t = Date.now(); for (;;) { const j = S.jobsApi.getJob(id); if (!['queued', 'running'].includes(j.internalStatus) || Date.now() - t > ms) return j; await new Promise(r => setTimeout(r, 100)); } };
const shim = path.join(TMP, 'bin'); fs.mkdirSync(shim); fs.writeFileSync(path.join(shim, 'opencode'), '#!/bin/sh\necho "opencode shim $@"\nsleep 30\n', { mode: 0o755 });
const ff = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim();
// 1 real ffmpeg render
if (ff) { const { jobId } = S.jobsApi.createJob({ type: 'render_segment', input: { script: 'Привет, MOONKATTY', durationSec: 2, aspect: '9:16' } });
  const j = await wait(jobId); const a = (j.artifacts || [])[0] || {};
  const pr = a.path ? spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', a.path], { encoding: 'utf8' }) : { stdout: '{}' };
  const info = JSON.parse(pr.stdout || '{}'); const v = (info.streams || []).find(s => s.codec_type === 'video') || {};
  ok('render_segment ffmpeg -> succeeded, real mp4 2s 720x1280 + audio', j.status === 'succeeded' && Math.abs(Number(info.format?.duration) - 2) < 0.2 && v.width === 720 && v.height === 1280 && (info.streams || []).some(s => s.codec_type === 'audio'), JSON.stringify({ st: j.status, err: j.error, d: info.format?.duration, w: v.width, h: v.height }));
  ok('host3d.renderSegment returns real videoPath', fs.existsSync((await S.host3d.renderSegment({ script: '', durationSec: 1, outPath: path.join(TMP, 'h.mp4') })).videoPath));
} else ok('ffmpeg available on box', false, 'ffmpeg not found');
// 2 validation
let threw = false; try { S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 0 } }); } catch { threw = true; } ok('render_segment invalid durationSec rejected', threw);
threw = false; try { S.jobsApi.createJob({ type: 'opencode_task', input: {} }); } catch { threw = true; } ok('opencode_task empty prompt rejected', threw);
// 3 tools missing -> honest failure
const P0 = process.env.PATH, H0 = process.env.HOME; process.env.PATH = '/nonexistent'; process.env.HOME = TMP; delete process.env.OPENCODE_BIN;
let r = await wait(S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'hello' } }).jobId); ok('opencode missing -> failed "opencode not installed"', r.status === 'failed' && /opencode not installed/.test(r.error), r.error);
r = await wait(S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 } }).jobId); ok('ffmpeg missing -> failed "ffmpeg not installed"', r.status === 'failed' && /ffmpeg not installed/.test(r.error), r.error);
r = await wait(S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, engine: 'blender' } }).jobId); ok('blender missing (engine=blender) -> failed honestly', r.status === 'failed' && !!r.error, r.error);
process.env.PATH = shim + ':' + P0;
// 4 timeout (real child process: opencode shim sleeping 30s, timeoutSec 1)
const t0 = Date.now(); r = await wait(S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' }, timeoutSec: 1 }).jobId); ok('opencode_task timeout -> failed timeout, child killed', r.status === 'failed' && /timeout/.test(r.error) && Date.now() - t0 < 10000, r.error);
// 5 cancel
const c = S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' } }).jobId; await new Promise(x => setTimeout(x, 500)); S.jobsApi.cancelJob(c); r = await wait(c); ok('opencode_task cancel -> cancelled', r.status === 'cancelled', r.status + ' ' + r.error);
ok('opencode shim really ran (log)', fs.readFileSync(path.join(TMP, 'media', 'opencode-tasks', c, 'opencode.log'), 'utf8').includes('opencode shim run x'));
process.env.PATH = P0; process.env.HOME = H0;
// 6 resume after restart: queued render_segment re-runs (safeToRetry), opencode_task (safeToRetry=false) fails
const rs = jobs.create('t-r', 'render_segment', 'render_segment'); jobs.update(rs.id, { status: 'queued', safeToRetry: true, input: { script: '', durationSec: 1, aspect: '1:1', engine: 'ffmpeg' } });
const ro = jobs.create('t-o', 'opencode_task', 'opencode_task'); jobs.update(ro.id, { status: 'queued', safeToRetry: false, input: { prompt: 'x' } });
S.resume(); const rr = await wait(rs.id), roj = S.jobsApi.getJob(ro.id);
ok('resume: render_segment re-run -> succeeded', !ff || rr.status === 'succeeded', rr.status + ' ' + rr.error);
ok('resume: opencode_task (not safeToRetry) -> failed', roj.status === 'failed', roj.error);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
