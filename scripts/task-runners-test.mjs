// Real-command tests for opencode_task / render_segment runners (lib/task-runners.js via lib/services.js).
// Uses the real job engine (node:sqlite) and real ffmpeg. Usage: node scripts/task-runners-test.mjs (Node >= 22.5)
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';
const require = createRequire(import.meta.url); process.env.STUDIO_SQLITE = 'node';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tr-')); const db = require('../lib/db.js').open(path.join(TMP, 'db.sqlite'));
const jobs = require('../lib/jobs.js')(db); const blender = require('../lib/blender.js')();
const store = {}; let n = 0; const core = { uid: () => 'u' + (++n), now: () => new Date().toISOString() };
const get = (c, id) => (store[c] || {})[id], put = (c, o) => ((store[c] = store[c] || {})[o.id] = o, o);
const mk = (o = {}) => require('../lib/services.js')({ jobs, design3d: { cancelJob() {}, artifact: (d, f) => ({ path: path.join(d, f) }) }, runner: { cancelTask() {}, tick() {}, start() {} }, blender, ws: require('../lib/workspace.js')(TMP), get, put, core, log() {}, mediaRoot: path.join(TMP, 'media'), hideDirs: [TMP], ...o });
const S = mk(); const TR = require('../lib/task-runners.js');
let fail = 0; const ok = (name, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + name + (x ? ' — ' + x : '')); if (!c) fail++; };
const wait = async (id, ms = 60000) => { const t = Date.now(); for (;;) { const j = S.jobsApi.getJob(id); if (!['queued', 'running'].includes(j.internalStatus) || Date.now() - t > ms) return j; await new Promise(r => setTimeout(r, 100)); } };
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tr-out-')); // outside the data dir: shim + "attacker" targets
const shim = path.join(OUT, 'bin'); fs.mkdirSync(shim); fs.writeFileSync(path.join(TMP, 'secret.txt'), 'TOPSECRET');
fs.writeFileSync(path.join(shim, 'opencode'), `#!/bin/sh\necho "opencode shim $@"\necho "ENV:$(env | cut -d= -f1 | tr '\\n' ,)"\necho "SECRETVAL:$STUDIO_SECRET_KEY"\ncat ${TMP}/secret.txt 2>/dev/null && echo READ_HIDDEN\necho x > ${OUT}/escape.txt 2>/dev/null && echo WROTE_OUTSIDE\necho ok > ./inside.txt && echo WROTE_INSIDE\nsleep 30\n`, { mode: 0o755 });
S.setApprovalCheck((id, p) => id === 'appr-ok'); const OA = 'appr-ok';
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
let r = await wait(S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'hello' }, approvalId: OA }).jobId); ok('opencode missing -> failed "opencode not installed"', r.status === 'failed' && /opencode not installed/.test(r.error), r.error);
r = await wait(S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 } }).jobId); ok('ffmpeg missing -> failed "ffmpeg not installed"', r.status === 'failed' && /ffmpeg not installed/.test(r.error), r.error);
r = await wait(S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, engine: 'blender' } }).jobId); ok('blender missing (engine=blender) -> failed honestly', r.status === 'failed' && !!r.error, r.error);
process.env.PATH = shim + ':' + P0;
// 4 timeout (real child process: opencode shim sleeping 30s, timeoutSec 1)
const t0 = Date.now(); r = await wait(S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' }, timeoutSec: 1, approvalId: OA }).jobId); ok('opencode_task timeout -> failed timeout, child killed', r.status === 'failed' && /timeout/.test(r.error) && Date.now() - t0 < 10000, r.error);
// 5 cancel
process.env.STUDIO_SECRET_KEY = 'sk-should-not-leak'; process.env.MK_FAKE_TOKEN = 'tok-x';
const c = S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' }, approvalId: OA }).jobId; await new Promise(x => setTimeout(x, 1000));
ok('opencode_task holds the global heavy lock while running', JSON.stringify(S.heavyStatus()).includes('opencode_task:' + c), JSON.stringify(S.heavyStatus())); S.jobsApi.cancelJob(c); r = await wait(c); ok('opencode_task cancel -> cancelled', r.status === 'cancelled', r.status + ' ' + r.error);
const lg = fs.readFileSync(path.join(TMP, 'media', 'opencode-tasks', c, 'opencode.log'), 'utf8');
ok('opencode shim really ran with "--" before prompt', lg.includes('opencode shim run -- x'), lg.slice(0, 200));
ok('env allowlist: no STUDIO_SECRET_KEY / tokens in child env', !/STUDIO_SECRET_KEY|MK_FAKE_TOKEN/.test(lg.split('ENV:')[1] || 'X') && lg.includes('SECRETVAL:\n'), lg);
ok('sandbox: data dir hidden (secret not readable)', !lg.includes('TOPSECRET') && !lg.includes('READ_HIDDEN'), lg);
ok('sandbox: no writes outside workDir', !lg.includes('WROTE_OUTSIDE') && !fs.existsSync(path.join(OUT, 'escape.txt')), lg);
ok('sandbox: workDir writable', lg.includes('WROTE_INSIDE'), lg);
delete process.env.STUDIO_SECRET_KEY; delete process.env.MK_FAKE_TOKEN;
process.env.PATH = P0; process.env.HOME = H0;
// 7 approval / prompt / audioPath / test flavor / no sandbox
const thr = f => { try { f(); return null; } catch (e) { return e.message; } };
ok('opencode_task without approval -> rejected', /подтверждение/.test(thr(() => S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' } })) || ''));
ok('opencode_task with forged approvalId -> rejected', /подтверждение/.test(thr(() => S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' }, approvalId: 'forged' })) || ''));
ok('prompt starting with "-" rejected', /"-"/.test(thr(() => S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: '--dangerous-flag' }, approvalId: OA })) || ''));
const media = path.join(TMP, 'media'); fs.writeFileSync(path.join(media, 'ok.wav'), 'x'); fs.symlinkSync('/etc/passwd', path.join(media, 'link.wav'));
const e1 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: '/etc/passwd' } }));
const e2 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: '/etc/nonexistent-xyz' } }));
const e3 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: path.join(media, 'link.wav') } }));
const e4 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: '../secret.txt' } }));
ok('audioPath outside media / missing / symlink-out / ../ -> one uniform error (no existence oracle)', e1 && e1 === e2 && e2 === e3 && e3 === e4, [e1, e2, e3, e4].join(' | '));
ok('audioPath inside media accepted (realpath)', TR.validateSegment({ durationSec: 1, audioPath: 'ok.wav' }, media).input?.audioPath === fs.realpathSync(path.join(media, 'ok.wav')));
const ST = mk({ isTest: true }); ST.setApprovalCheck(() => true); delete process.env.MK_TEST_REAL_RUNNERS;
r = await wait(ST.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 } }).jobId); ok('TEST flavor: real runners disabled -> failed honestly', r.status === 'failed' && /TEST/.test(r.error), r.error);
const ns = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require('./lib/task-runners.js').sandboxed('/bin/true', [], { workDir: '/tmp' })))"], { cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..'), env: { PATH: '/nonexistent' }, encoding: 'utf8' });
ok('no sandbox available -> sandboxed() null (opencode refused)', ns.stdout === 'null', ns.stdout + ns.stderr);
// 6 resume after restart: queued render_segment re-runs (safeToRetry), opencode_task (safeToRetry=false) fails
const rs = jobs.create('t-r', 'render_segment', 'render_segment'); jobs.update(rs.id, { status: 'queued', safeToRetry: true, input: { script: '', durationSec: 1, aspect: '1:1', engine: 'ffmpeg' } });
const ro = jobs.create('t-o', 'opencode_task', 'opencode_task'); jobs.update(ro.id, { status: 'queued', safeToRetry: false, input: { prompt: 'x' } });
S.resume(); const rr = await wait(rs.id), roj = S.jobsApi.getJob(ro.id);
ok('resume: render_segment re-run -> succeeded', !ff || rr.status === 'succeeded', rr.status + ' ' + rr.error);
ok('resume: opencode_task (not safeToRetry) -> failed', roj.status === 'failed', roj.error);
fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
