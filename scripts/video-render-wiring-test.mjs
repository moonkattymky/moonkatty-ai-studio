// v1.3.0-test: Studio 2 createVideoRenderExecutor wired into lib/services.js — cancel → cancelled, symlinked DATA_DIR,
// exactly three artifacts {name,path,size,sha256,kind} inside DATA_DIR/media. Fake factory (no ffmpeg/TTS). Usage: node scripts/video-render-wiring-test.mjs
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
const { createVideoRenderExecutor, writeEpisode } = require('../media-automation/src/jobs');
const res = []; const ok = (n, c, x = '') => { res.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms)); const until = async (f, ms = 4000) => { for (let i = 0; i < ms / 20; i++) { if (f()) return true; await sleep(20); } return false; };
async function setup(name, { symlink = false, slow = false } = {}) {
  const T = '/tmp/mk-vrw-' + name; fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T + '/real', { recursive: true });
  let DATA = T + '/real'; if (symlink) { fs.symlinkSync(T + '/real', T + '/link'); DATA = T + '/link'; }
  const { open } = require('../lib/db.js'); const db = open(T + '/t.db'); const jobs = require('../lib/jobs.js')(db);
  const store = new Map(); const get = (c, id) => store.get(c + ':' + id); const put = (c, o) => { store.set(c + ':' + o.id, o); return o; };
  let n = 0; const core = { uid: () => name + (++n), now: () => new Date().toISOString() };
  const S = require('../lib/services.js')({ jobs, design3d: { cancelJob() {}, artifact() {} }, runner: { start() {}, tick() {}, cancelTask() {} }, blender: { detect: async () => ({ ok: false }) }, ws: {}, get, put, core, log() {}, mediaRoot: path.join(DATA, 'media') });
  const factory = { async render(ep, { outDir, basename, signal }) {
    if (slow) await new Promise((r, j) => { const t = setTimeout(r, 3000); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }); });
    const f = e => { const p = path.join(outDir, basename + '.' + e); fs.writeFileSync(p, 'fake-' + e); return p; };
    return { files: { video: f('mp4'), subtitles: f('srt'), thumbnail: f('jpg') } }; } };
  S.videoRender.setExecutor(createVideoRenderExecutor({ dataDir: DATA, factory, llm: null }));
  writeEpisode(DATA, 's01/e01', { title: 't', stories: [{ title: 'a', text: 'b' }] });
  return { S, api: S.jobsApi, DATA, T };
}
const input = { runId: 'run_1', preset: 'youtube', episodeRef: 's01/e01' };
for (const symlink of [false, true]) {
  const { api, DATA } = await setup(symlink ? 'link' : 'plain', { symlink });
  const { jobId } = api.createJob({ type: 'video_render', input });
  await until(() => ['succeeded', 'failed', 'cancelled'].includes(api.getJob(jobId).status));
  const j = api.getJob(jobId); const arts = (j.artifacts || j.output?.artifacts || []);
  ok(`${symlink ? 'symlinked' : 'plain'} DATA_DIR: render succeeded`, j.status === 'succeeded', JSON.stringify(j));
  ok(`${symlink ? 'symlinked' : 'plain'} DATA_DIR: exactly 3 artifacts mp4/srt/jpg`, arts.length === 3 && ['mp4', 'srt', 'jpg'].every(k => arts.some(a => a.path?.endsWith('.' + k))), JSON.stringify(arts));
  ok(`${symlink ? 'symlinked' : 'plain'} DATA_DIR: artifacts inside media, full schema`, arts.length === 3 && arts.every(a => ['name', 'path', 'size', 'sha256', 'kind'].every(k => k in a) && fs.realpathSync(a.path).startsWith(fs.realpathSync(path.join(DATA, 'media')) + path.sep)));
}
{ const { api } = await setup('cancel', { slow: true });
  const { jobId } = api.createJob({ type: 'video_render', input });
  await until(() => api.getJob(jobId).status === 'running'); api.cancelJob(jobId);
  await until(() => ['succeeded', 'failed', 'cancelled'].includes(api.getJob(jobId).status)); await sleep(200);
  ok('cancel during render ends as cancelled (not failed)', api.getJob(jobId).status === 'cancelled', JSON.stringify(api.getJob(jobId))); }
{ const { selectJobQueue } = require('../media-automation/src/jobs'); ok('MA_JOBS_BACKEND default off → local', selectJobQueue({ env: {}, local: 'L' }).backend === 'local'); }
const f = res.filter(x => !x).length; console.log(`\n${res.length - f}/${res.length} passed`); process.exit(f ? 1 : 0);
