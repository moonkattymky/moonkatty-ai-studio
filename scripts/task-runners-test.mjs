// Real-command tests for opencode_task / render_segment runners (lib/task-runners.js via lib/services.js).
// Uses the real job engine (node:sqlite) and real ffmpeg. Usage: node scripts/task-runners-test.mjs (Node >= 22.5)
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process'; import http from 'http';
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
const PLANT = path.join(os.homedir(), '.mk-sbx-planted-' + process.pid); fs.writeFileSync(PLANT, 'PLANTED_HOME_SECRET');
let hits = 0; const hs = http.createServer((q, r) => { hits++; r.end('STUDIO_API'); }); await new Promise(r => hs.listen(0, '127.0.0.1', r)); const HP = hs.address().port;
fs.writeFileSync(path.join(shim, 'opencode'), `#!/bin/bash\ncat ${PLANT} 2>/dev/null; ls ${os.homedir()}/.config >/dev/null 2>&1 && echo SAW_REAL_HOME\n(exec 3<>/dev/tcp/127.0.0.1/${HP} && printf 'GET / HTTP/1.0\\r\\n\\r\\n' >&3 && cat <&3) 2>/dev/null && echo NET_OK || echo NET_BLOCKED\n(while true; do date +%s%N >> ./grandchild.txt; sleep 0.2; done) &\necho "opencode shim $@"\necho "ENV:$(env | cut -d= -f1 | tr '\\n' ,)"\necho "SECRETVAL:$STUDIO_SECRET_KEY"\ncat ${TMP}/secret.txt 2>/dev/null && echo READ_HIDDEN\necho x > ${OUT}/escape.txt 2>/dev/null && echo WROTE_OUTSIDE\necho ok > ./inside.txt && echo WROTE_INSIDE\nsleep 30\n`, { mode: 0o755 });
S.setApprovalCheck(id => id === 'appr-ok'); const OA = 'appr-ok';
const ff = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim();
// 1 real ffmpeg render
if (ff) { const { jobId } = S.jobsApi.createJob({ type: 'render_segment', input: { script: 'Привет, MOONKATTY', durationSec: 2, aspect: '9:16' }, approvalId: OA });
  const j = await wait(jobId); const a = (j.artifacts || [])[0] || {};
  const pr = a.path ? spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', a.path], { encoding: 'utf8' }) : { stdout: '{}' };
  const info = JSON.parse(pr.stdout || '{}'); const v = (info.streams || []).find(s => s.codec_type === 'video') || {};
  ok('render_segment ffmpeg -> succeeded, real mp4 2s 720x1280 + audio', j.status === 'succeeded' && Math.abs(Number(info.format?.duration) - 2) < 0.2 && v.width === 720 && v.height === 1280 && (info.streams || []).some(s => s.codec_type === 'audio'), JSON.stringify({ st: j.status, err: j.error, d: info.format?.duration, w: v.width, h: v.height }));
  ok('host3d.renderSegment returns real videoPath', fs.existsSync((await S.host3d.renderSegment({ script: '', durationSec: 1, outPath: path.join(TMP, 'h.mp4') })).videoPath));
} else ok('ffmpeg available on box', false, 'ffmpeg not found');
// 2 validation
let threw = false; try { S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 0 }, approvalId: OA }); } catch { threw = true; } ok('render_segment invalid durationSec rejected', threw);
threw = false; try { S.jobsApi.createJob({ type: 'opencode_task', input: {} }); } catch { threw = true; } ok('opencode_task empty prompt rejected', threw);
// 3 tools missing -> honest failure
const P0 = process.env.PATH, H0 = process.env.HOME; process.env.PATH = '/nonexistent'; process.env.HOME = TMP; delete process.env.OPENCODE_BIN;
let r = await wait(S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'hello' }, approvalId: OA }).jobId); ok('opencode missing -> failed "opencode not installed"', r.status === 'failed' && /opencode not installed/.test(r.error), r.error);
r = await wait(S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 }, approvalId: OA }).jobId); ok('ffmpeg missing -> failed "ffmpeg not installed"', r.status === 'failed' && /ffmpeg not installed/.test(r.error), r.error);
r = await wait(S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, engine: 'blender' }, approvalId: OA }).jobId); ok('blender missing (engine=blender) -> failed honestly', r.status === 'failed' && !!r.error, r.error);
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
ok('sandbox: no writes outside workDir reach the host', !fs.existsSync(path.join(OUT, 'escape.txt')), lg);
ok('sandbox: planted file in real $HOME not readable', !lg.includes('PLANTED_HOME_SECRET') && !lg.includes('SAW_REAL_HOME'), lg);
ok('sandbox: localhost HTTP (Studio API) unreachable, no network', lg.includes('NET_BLOCKED') && !lg.includes('STUDIO_API') && hits === 0, lg);
{ const gf = path.join(TMP, 'media', 'opencode-tasks', c, 'grandchild.txt'); const a1 = fs.existsSync(gf) ? fs.readFileSync(gf).length : -1; await new Promise(x => setTimeout(x, 1200)); const a2 = fs.existsSync(gf) ? fs.readFileSync(gf).length : -1;
  ok('cancel kills the whole process group: grandchild stopped', a1 > 0 && a1 === a2, JSON.stringify({ a1, a2 })); }
hs.close(); fs.rmSync(PLANT, { force: true });
ok('sandbox: workDir writable', lg.includes('WROTE_INSIDE'), lg);
delete process.env.STUDIO_SECRET_KEY; delete process.env.MK_FAKE_TOKEN;
process.env.PATH = P0; process.env.HOME = H0;
// 7 approval / prompt / audioPath / test flavor / no sandbox
const thr = f => { try { f(); return null; } catch (e) { return e.message; } };
ok('render_segment without approval -> rejected', /подтверждение/.test(thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 } })) || ''));
ok('render_segment with forged approvalId -> rejected', /подтверждение/.test(thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 }, approvalId: 'forged' })) || ''));
ok('opencode_task without approval -> rejected', /подтверждение/.test(thr(() => S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' } })) || ''));
ok('opencode_task with forged approvalId -> rejected', /подтверждение/.test(thr(() => S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: 'x' }, approvalId: 'forged' })) || ''));
ok('prompt starting with "-" rejected', /"-"/.test(thr(() => S.jobsApi.createJob({ type: 'opencode_task', input: { prompt: '--dangerous-flag' }, approvalId: OA })) || ''));
const media = path.join(TMP, 'media'); fs.writeFileSync(path.join(media, 'ok.wav'), 'x'); fs.symlinkSync('/etc/passwd', path.join(media, 'link.wav'));
const e1 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: '/etc/passwd' }, approvalId: OA }));
const e2 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: '/etc/nonexistent-xyz' }, approvalId: OA }));
const e3 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: path.join(media, 'link.wav') }, approvalId: OA }));
const e4 = thr(() => S.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1, audioPath: '../secret.txt' }, approvalId: OA }));
ok('audioPath outside media / missing / symlink-out / ../ -> one uniform error (no existence oracle)', e1 && e1 === e2 && e2 === e3 && e3 === e4, [e1, e2, e3, e4].join(' | '));
ok('audioPath inside media accepted (realpath)', TR.validateSegment({ durationSec: 1, audioPath: 'ok.wav' }, media).input?.audioPath === fs.realpathSync(path.join(media, 'ok.wav')));
const ST = mk({ isTest: true }); ST.setApprovalCheck(() => true); delete process.env.MK_TEST_REAL_RUNNERS;
r = await wait(ST.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 }, approvalId: OA }).jobId); ok('TEST flavor: real runners disabled -> failed honestly', r.status === 'failed' && /TEST/.test(r.error), r.error);
const ns = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require('./lib/task-runners.js').sandboxed('/bin/true', [], { workDir: '/tmp' })))"], { cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..'), env: { PATH: '/nonexistent' }, encoding: 'utf8' });
ok('no sandbox available -> sandboxed() null (opencode refused)', ns.stdout === 'null', ns.stdout + ns.stderr);
// NEW-2 packaged detection: MK_TEST_REAL_RUNNERS ignored when running from resourcesPath / app.asar
ok('isPackaged: dev tree -> false', TR.isPackaged() === false);
ok('isPackaged: app.asar path -> true', TR.isPackaged('/Applications/X.app/Contents/Resources/app.asar/lib') === true);
process.resourcesPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'); const pk = TR.isPackaged(); 
{ const SP2 = mk({ isTest: true }); SP2.setApprovalCheck(() => true); process.env.MK_TEST_REAL_RUNNERS = '1';
  const rp2 = await wait(SP2.jobsApi.createJob({ type: 'render_segment', input: { durationSec: 1 }, approvalId: OA }).jobId);
  ok('packaged build (resourcesPath) ignores MK_TEST_REAL_RUNNERS=1 -> disabled', pk === true && rp2.status === 'failed' && /TEST/.test(rp2.error), JSON.stringify({ pk, s: rp2.status, e: rp2.error })); }
delete process.resourcesPath; delete process.env.MK_TEST_REAL_RUNNERS;
// NEW-3 TOCTOU: swap the checked file between realpath check and open
{ const mr = path.join(TMP, 'media'); fs.writeFileSync(path.join(mr, 'a.wav'), 'GOOD'); fs.writeFileSync(path.join(mr, 'other.wav'), 'OTHER'); const d1 = fs.mkdtempSync(path.join(TMP, 'cp-'));
  const okc = TR.copyConfined('a.wav', mr, d1); ok('copyConfined: private copy in workDir with same bytes', fs.readFileSync(okc, 'utf8') === 'GOOD' && okc.startsWith(d1));
  const t1 = (() => { try { TR.copyConfined('a.wav', mr, fs.mkdtempSync(path.join(TMP, 'cp-')), { _afterCheck: rp => { fs.rmSync(rp); fs.symlinkSync('/etc/passwd', rp); } }); return 'no error'; } catch (e) { return e.message; } })();
  ok('race: file swapped to symlink after check -> rejected (O_NOFOLLOW)', t1 === TR.AUDIO_ERR, t1);
  fs.rmSync(path.join(mr, 'a.wav')); fs.writeFileSync(path.join(mr, 'a.wav'), 'GOOD');
  const t2 = (() => { try { TR.copyConfined('a.wav', mr, fs.mkdtempSync(path.join(TMP, 'cp-')), { _afterCheck: rp => { fs.renameSync(path.join(mr, 'other.wav'), rp); } }); return 'no error'; } catch (e) { return e.message; } })();
  ok('race: file replaced by another inode after check -> rejected (fstat dev/ino)', t2 === TR.AUDIO_ERR, t2); }
if (ff) { const rq = await S.host3d.renderSegment({ script: 'x', durationSec: 1, outPath: path.join(TMP, 'media', 'segments', 'sb.mp4'), mediaRoot: path.join(TMP, 'media') });
  ok('render_segment: ffmpeg runs inside the sandbox', rq.sandbox === 'bwrap' && fs.statSync(rq.videoPath).size > 0, JSON.stringify(rq)); }
// 6 resume after restart: queued render_segment re-runs (safeToRetry), opencode_task (safeToRetry=false) fails
const rs = jobs.create('t-r', 'render_segment', 'render_segment'); jobs.update(rs.id, { status: 'queued', safeToRetry: true, input: { script: '', durationSec: 1, aspect: '1:1', engine: 'ffmpeg' } });
const ro = jobs.create('t-o', 'opencode_task', 'opencode_task'); jobs.update(ro.id, { status: 'queued', safeToRetry: false, input: { prompt: 'x' } });
S.resume(); const rr = await wait(rs.id), roj = S.jobsApi.getJob(ro.id);
ok('resume: render_segment re-run -> succeeded', !ff || rr.status === 'succeeded', rr.status + ' ' + rr.error);
ok('resume: opencode_task (not safeToRetry) -> failed', roj.status === 'failed', roj.error);
fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
