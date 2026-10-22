// S5-NV-01 regression: over-long words (60+ chars, URLs, hashtags, Cyrillic) must never break 9:16 (28-char) subtitles or on-screen text.
// Unit part always runs. REAL part (actual 9:16 ffmpeg render through the API) runs when PW_FILE is set (STUDIO_URL, default 8687).
import fs from 'fs'; import { createRequire } from 'module'; import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { hardSplit, chunk, buildSrt } = require('../media-automation/src/video/subtitles.js'); const { validateSrt } = require('../media-automation/src/video/srtcheck.js');
const { wrapWords } = require('../media-automation/src/video/graphics.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const LONG = 'Supercalifragilisticexpialidociousnesswordthatkeepsgoingandgoing'; // 64 chars
const URL_ = 'https://www.nasa.gov/news-release/artemis-ii-crew-completes-final-simulation-2026/';
const CYR = 'Превысокомногорассмотрительствующийсяпревысокомногорассмотрительный'; const TAG = '#ОченьДлинныйХэштегБезПробеловВообщеСовсемНикакихПробелов';
const TEXT = `NASA reports ${LONG} progress. Details at ${URL_} today. Это ${CYR} пример ${TAG} конец.`;
for (const max of [26, 28, 42, 46]) {
  const ps = [LONG, URL_, CYR, TAG].flatMap(w => hardSplit(w, max)); t(`hardSplit: every piece <= ${max} chars`, ps.every(p => Array.from(p).length <= max), ps.filter(p => Array.from(p).length > max).join(','));
  t(`chunk(${max}): no line over limit`, chunk(TEXT, max).every(l => Array.from(l).length <= max));
  const srt = buildSrt([{ text: TEXT, start: 0, duration: 30 }], { maxChars: max, maxDur: 7.5 }); const v = validateSrt(srt, { maxChars: max, totalSec: 31 });
  t(`buildSrt+validateSrt(${max}) ok`, v.ok, (v.errors || []).slice(0, 3).join('; '));
  t(`wrapWords(${max}) on-screen lines within limit`, wrapWords(`Headline ${LONG} ${CYR}`, max, 3).every(l => Array.from(l).length <= max + 1));
}
t('hardSplit keeps all characters (rejoin minus added hyphens)', hardSplit(LONG, 28).map(p => p.replace(/-$/, '')).join('') === LONG);
t('URL split at natural break points (no added hyphen mid-token)', hardSplit(URL_, 28).slice(0, -1).every(p => /[\/\-_.?&=#:]$/.test(p)));
t('short words untouched', JSON.stringify(hardSplit('NASA', 28)) === '["NASA"]');
if (!process.env.PW_FILE) { console.log('SKIP real 9:16 render: set PW_FILE'); }
else {
  const B = process.env.STUDIO_URL || 'http://127.0.0.1:8687'; const pw = fs.readFileSync(process.env.PW_FILE, 'utf8').trim(); let cookie = '';
  const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-studio-request': '1', origin: B, cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
  await call('POST', '/api/auth/login', { username: 'igor', password: pw });
  let c = (await call('GET', '/api/newsvideo/stories')).j.candidates; if (!c.length) c = (await call('POST', '/api/newsvideo/search')).j.candidates;
  const d = (await call('POST', '/api/newsvideo/drafts', { storyIds: [c[0].id] })).j; t('real: draft created', d && d.id, d && d.error);
  await call('PUT', `/api/newsvideo/drafts/${d.id}`, { title: 'Long word ' + LONG, stories: [{ id: d.stories[0].id, headline: 'Headline ' + LONG, text: TEXT }] });
  const h = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j.contentHash; const a = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: h }); t('real: approved', a.j.status === 'approved', a.j.error);
  const r = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset: 'shorts' }); t('real: 9:16 render started', r.j.status === 'rendering', r.j.error);
  let g; for (let i = 0; i < 120; i++) { await new Promise(z => setTimeout(z, 5000)); g = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; if (g.status !== 'rendering') break; }
  t('real: 9:16 render with 64-char word succeeded', g.status === 'rendered', g.status + ' ' + (g.renders.at(-1).error || ''));
  if (g.status === 'rendered') {
    const out = process.env.OUTMP4 || '/tmp/longword_shorts.mp4'; fs.writeFileSync(out, Buffer.from(await (await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=mp4&download=1`, { headers: { cookie } })).arrayBuffer()));
    const pr = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', out]).toString().trim(); t('real: MP4 is 1080x1920', /1080,1920/.test(pr), pr.replace(/\n/g, ' ') + ' → ' + out);
    const srt = await (await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=srt&download=1`, { headers: { cookie } })).text();
    const lines = srt.split('\n').filter(l => l && !/^\d+$/.test(l) && !/-->/.test(l)); t('real: all SRT lines <= 28 chars', lines.every(l => Array.from(l).length <= 28), lines.filter(l => Array.from(l).length > 28).join(' | '));
    t('real: long word present (split) in SRT', srt.includes('Supercalifragilisticexpiali'));
  }
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
