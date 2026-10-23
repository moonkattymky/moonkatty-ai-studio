// One real NewsVideoFactory episode (demo fixture, not a fact-checked release) at 1920x1080 and 1080x1920.
// FFMPEG_BIN_DIR prepends a chosen ffmpeg/ffprobe (use a build without libass to exercise the SVG fallback).
// Prints ffprobe and SHA-256. Copies mp4/srt/json to MK_ARTIFACTS when that directory exists.
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const { NewsVideoFactory } = require('../media-automation/src/video/factory2.js');
const { detectTTS } = require('../media-automation/src/video/tts.js');
const { run } = require('../media-automation/src/video/exec.js');

const binDir = process.env.FFMPEG_BIN_DIR;
if (binDir) process.env.PATH = binDir + path.delimiter + process.env.PATH;
const tag = process.env.RENDER_TAG || (binDir ? 'custom' : 'system');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-ep-'));
const card = path.join(root, 'card.png');
// Same texture as lib/news-video.js card(): a plain gradient Ken Burns / blur-fill
// stays under freezedetect n=-60dB. Grain is static; the factory pan is what moves it.
spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=2400x1400:c0=0x0b1030:c1=0x3a1c71:x0=0:y0=0:x1=2400:y1=1400:d=1',
  '-f', 'lavfi', '-i', "nullsrc=s=2400x1400,geq=lum='255*gt(random(1),0.996)+40*pow(sin(hypot(X-1700,Y-500)/38),8)':cb=128:cr=128",
  '-filter_complex', '[1:v]format=gray,gblur=sigma=1.2,format=rgb24[s];[0:v]format=rgb24,noise=alls=14:allf=u[g];[g][s]blend=all_mode=screen,format=rgb24',
  '-frames:v', '1', card], { stdio: 'inherit' });
if (!fs.existsSync(card)) { console.error('card png missing'); process.exit(1); }
const tts = await detectTTS();
console.log('tts', tts.name, 'ffmpeg', spawnSync('ffmpeg', ['-version']).stdout.toString().split('\n')[0]);
const text = 'This is fictional demonstration audio for the video pipeline. It was not fact-checked and must not be published. Details would have been at https://example.invalid/demo-test-url-not-a-news-source-2026-moonkatty and the tag #DemoTestNotReal.';
const episode = {
  title: '[ДЕМО] Тестовые данные — не новость', dateLabel: 'Oct 23, 2026', demo: true, synthetic: true, factChecked: false,
  formatTitle: 'ДЕМО · ТЕСТОВЫЕ ДАННЫЕ · ФАКТЫ НЕ ПРОВЕРЯЛИСЬ',
  stories: [{ id: 'demostory01', category: 'science', headline: 'TEST DATA — not a news item', text, asset: { id: 'card-demostory01', localPath: card, width: 2400, height: 1400, attribution: 'DEMO background, not a news image', license: 'own' } }],
  sources: [{ name: 'DEMO FIXTURE (not a source of facts)', url: 'https://example.invalid/demo-fixture' }],
  rights: ['Demo fixture. Not a news release. Not fact-checked.']
};
const art = process.env.MK_ARTIFACTS || '/opt/cursor/artifacts/video';
fs.mkdirSync(art, { recursive: true });
const factory = new NewsVideoFactory({ tts, workRoot: root });
for (const preset of ['youtube', 'shorts']) {
  const outDir = path.join(root, preset);
  fs.mkdirSync(outDir, { recursive: true });
  const base = `news-${preset}-${tag}`;
  let manifest = null, qaError = null;
  try { manifest = await factory.render(episode, { preset, outDir, basename: base }); }
  catch (e) { qaError = e.message; manifest = e.manifest || null; console.error('RENDER', preset, e.message); }
  const mp4 = path.join(outDir, base + '.mp4');
  if (!fs.existsSync(mp4)) { console.error('no mp4', mp4); process.exit(1); }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(mp4)).digest('hex');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate', '-of', 'compact', mp4], { encoding: 'utf8' });
  const dest = path.join(art, `${base}.mp4`);
  fs.copyFileSync(mp4, dest);
  for (const ext of ['.srt', '.json']) { const f = path.join(outDir, base + ext); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(art, base + ext)); }
  console.log(JSON.stringify({ preset, tag, file: dest, bytes: fs.statSync(mp4).size, sha256: sha, probe: probe.stdout.trim(), method: manifest && manifest.subtitleMethod, qaOk: !qaError, qaError, tts: tts.name }, null, 2));
}
