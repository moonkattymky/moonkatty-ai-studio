// Real ffmpeg burns: libass (system) and SVG (ffmpeg built without libass). Full HD and vertical.
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { execFile } from 'child_process';
const require = createRequire(import.meta.url);
const { burnSubtitles, filtersHaveAss, assFilter, escapeFilterValue, detectSubtitleMethod } = require('../media-automation/src/video/burn.js');
const { run } = require('../media-automation/src/video/exec.js');
const { hardSplit } = require('../media-automation/src/video/subtitles.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const NOLIB = process.env.FFMPEG_NOLIBASS || '/opt/ffmpeg-nolibass/bin/ffmpeg';
const NOPROBE = process.env.FFPROBE_NOLIBASS || '/opt/ffmpeg-nolibass/bin/ffprobe';
const artDir = process.env.MK_ARTIFACTS || '/opt/cursor/artifacts/video';
fs.mkdirSync(artDir, { recursive: true });
const probe = (bin, file) => new Promise((res, rej) => execFile(bin, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], (e, so, se) => e ? rej(new Error(se || e.message)) : res(JSON.parse(so))));
const vol = (bin, file) => new Promise(res => execFile(bin, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], (e, so, se) => res(String(se))));
function runner(ffmpeg, ffprobe) {
  return (cmd, args, opts) => run(cmd === 'ffmpeg' ? ffmpeg : cmd === 'ffprobe' ? ffprobe : cmd, args, opts);
}
async function plate(ffmpeg, file, w, h) {
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x14203a:s=${w}x${h}:d=3,format=yuv420p`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
}
const longUrl = 'https://www.nasa.gov/news-release/artemis-ii-crew-completes-final-simulation-2026-demo-token/';
t('hardSplit URL stays within 42', hardSplit(longUrl, 42).every(p => [...p].length <= 42) && hardSplit(longUrl, 42).length > 1);
t('ass filter uses filename=', assFilter('subs.ass') === 'ass=filename=subs.ass' && !assFilter('subs.ass').includes("'"));
t('escape colon and space', escapeFilterValue("a b:c's.ass") === "a\\ b\\:c\\'s.ass", escapeFilterValue("a b:c's.ass"));
const sysFilters = (await run('ffmpeg', ['-hide_banner', '-filters'])).stdout;
t('system ffmpeg lists ass', filtersHaveAss(sysFilters));
const noFilters = fs.existsSync(NOLIB) ? (await run(NOLIB, ['-hide_banner', '-filters'])).stdout : '';
t('nolibass ffmpeg has no ass filter', !!noFilters && !filtersHaveAss(noFilters), NOLIB);
t('auto method system is libass', await detectSubtitleMethod(runner('ffmpeg', 'ffprobe'), {}) === 'libass');
if (noFilters) t('auto method nolibass is svg', await detectSubtitleMethod(runner(NOLIB, NOPROBE), {}) === 'svg');

const cues = [
  { start: 0.2, end: 1.4, text: 'Engine test at Stennis is a demo line.' },
  { start: 1.5, end: 2.8, text: hardSplit(longUrl, 42).slice(0, 2).join('\n') + '\n#DemoTestNotReal'.trim() }
];
// second cue may be 3 lines after join; burn keeps two. Rebuild as two lines.
cues[1].text = [...hardSplit(longUrl, 42).slice(0, 1), '#DemoTestNotReal'].join('\n');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'burn-'));
const weird = path.join(root, "work dir, [x]");
async function burnOne(label, ffmpeg, ffprobe, method, w, h) {
  const dir = path.join(weird, label); fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'src.mp4'); const out = path.join(dir, 'out.mp4'); const srt = path.join(dir, 'out.srt');
  fs.writeFileSync(srt, '1\n00:00:00,200 --> 00:00:01,400\nEngine test at Stennis is a demo line.\n\n2\n00:00:01,500 --> 00:00:02,800\n' + cues[1].text.replace('\n', '\n') + '\n');
  await plate(ffmpeg, src, w, h);
  const burned = await burnSubtitles({ runFn: runner(ffmpeg, ffprobe), video: src, audio: src, out, cues, W: w, H: h, work: path.join(dir, 'w'), crf: 28, fps: 30, duration: 3, srtPath: srt, demo: true, method, presetName: 'ultrafast' });
  const info = await probe(ffprobe, out); const v = info.streams.find(s => s.codec_type === 'video'); const a = info.streams.find(s => s.codec_type === 'audio'); const s = info.streams.find(s => s.codec_type === 'subtitle');
  const mean = (await vol(ffprobe.replace(/ffprobe$/, 'ffmpeg'), out)).match(/mean_volume:\s*(-?[\d.]+) dB/);
  t(label + ' method', burned.method === method, burned.method);
  t(label + ' video', v && v.codec_name === 'h264' && v.width === w && v.height === h, v && `${v.codec_name} ${v.width}x${v.height}`);
  t(label + ' audio', a && a.codec_name === 'aac' && +a.sample_rate === 48000, a && `${a.codec_name} ${a.sample_rate}`);
  t(label + ' subtitle stream', s && /mov_text|subrip/.test(s.codec_name), s && s.codec_name);
  t(label + ' not silence', mean && +mean[1] > -50, mean && mean[1]);
  const dest = path.join(artDir, label + '.mp4'); fs.copyFileSync(out, dest); fs.copyFileSync(srt, dest.replace(/\.mp4$/, '.srt'));
  console.log('ARTIFACT', dest, fs.statSync(dest).size);
}
await burnOne('news-1920x1080-libass', 'ffmpeg', 'ffprobe', 'libass', 1920, 1080);
await burnOne('news-1080x1920-libass', 'ffmpeg', 'ffprobe', 'libass', 1080, 1920);
if (noFilters) {
  await burnOne('news-1920x1080-nolibass', NOLIB, NOPROBE, 'svg', 1920, 1080);
  await burnOne('news-1080x1920-nolibass', NOLIB, NOPROBE, 'svg', 1080, 1920);
  const auto = path.join(root, 'auto.mp4'); const src = path.join(root, 'auto-src.mp4');
  await plate(NOLIB, src, 640, 360);
  const srt = path.join(root, 'auto.srt'); fs.writeFileSync(srt, '1\n00:00:00,200 --> 00:00:02,000\nAuto svg\n');
  const r = await burnSubtitles({ runFn: runner(NOLIB, NOPROBE), video: src, audio: src, out: auto, cues: [{ start: 0.2, end: 2, text: 'Auto svg' }], W: 640, H: 360, work: path.join(root, 'auto-w'), duration: 3, srtPath: srt, presetName: 'ultrafast', crf: 30, fps: 30 });
  t('nolibass auto-selects svg without being told', r.method === 'svg');
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
