// F-1 regression: hard-split long words (64/100 chars, Latin + Cyrillic) must never yield cues shorter than the minimum
// («subtitle validation failed: too short»). Unit part always runs (normalizeCues edge cases + buildSrt/validateSrt for 16:9 & 9:16).
// REAL part (actual ffmpeg renders through the API, both presets) runs when PW_FILE is set (STUDIO_URL, default 8687);
// MP4 + ffprobe saved to OUTDIR (default /workspace/out/e2e-artifacts/final).
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { buildSrt, normalizeCues } = require('../media-automation/src/video/subtitles.js'); const { validateSrt, parseSrt } = require('../media-automation/src/video/srtcheck.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const L64 = 'Supercalifragilisticexpialidociousnesswordthatkeepsgoingandgoing'; const L100 = (L64 + 'Pneumonoultramicroscopicsilicovolcanoconiosis').slice(0, 100);
const C64 = 'Превысокомногорассмотрительствующийсяпревысокомногорассмотрительн'.slice(0, 64); const C100 = (C64 + 'Человеконенавистничествоэлектрофотополиграфический').slice(0, 100);
t('fixture lengths 64/100', [L64, C64].every(w => Array.from(w).length === 64) && [L100, C100].every(w => Array.from(w).length === 100));
const noOverlap = cs => cs.every((c, i) => !i || c.start >= cs[i - 1].end - 1e-6); const minOk = (cs, m) => cs.every(c => c.end - c.start >= m - 1e-6);
// ---- normalizeCues edge cases
const C = (s, e, x = 'w') => ({ start: s, end: e, text: x });
{ const r = normalizeCues([C(0, 0.3, 'a'), C(0.3, 3, 'b')], { minDur: 0.8 }); t('first cue short → borrows from next', minOk(r, 0.8) && noOverlap(r) && r.length === 2 && r[0].start === 0, JSON.stringify(r)); }
{ const r = normalizeCues([C(0, 3, 'a'), C(3, 3.3, 'b')], { minDur: 0.8, totalEnd: 3.3 }); t('last cue short, no room after → borrows from previous', minOk(r, 0.8) && noOverlap(r) && r[1].end <= 3.3 + 1e-9, JSON.stringify(r)); }
{ const r = normalizeCues([C(0, 3, 'a'), C(3, 3.3, 'b')], { minDur: 0.8, totalEnd: 10 }); t('last cue short, free time after → extends into it', r[1].end - r[1].start >= 0.8 - 1e-9 && r[0].end === 3); }
{ const r = normalizeCues([C(0, 2, 'a'), C(2, 2.3, 'b'), C(2.3, 2.6, 'c'), C(2.6, 2.9, 'd'), C(2.9, 6, 'e')], { minDur: 0.8, totalEnd: 6 }); t('consecutive short cues → all >= min, no overlap, span kept', minOk(r, 0.8) && noOverlap(r) && r[0].start === 0 && Math.abs(r.at(-1).end - 6) < 1e-9 && r.length === 5, JSON.stringify(r.map(c => +(c.end - c.start).toFixed(2)))); }
{ const r = normalizeCues([C(0, 0.5, 'a'), C(0.5, 1.0, 'b')], { minDur: 0.8, totalEnd: 1.0 }); t('timeline too tight → merged (text joined)', r.length === 1 && minOk(r, 0.8) === false ? r.length === 1 : r.length === 1, JSON.stringify(r)); t('merged text keeps both', r[0].text === 'a b'); }
{ const r = normalizeCues([C(0, 0.5, 'x'.repeat(40) + '\n' + 'y'.repeat(40)), C(0.5, 1.0, 'z'.repeat(40) + '\n' + 'q'.repeat(40))], { minDur: 0.8, maxChars: 42, totalEnd: 1.0 }); t('merge refused if it would exceed 2 lines (no illegal lines produced)', r.length === 2 && r.every(c => c.text.split('\n').every(l => l.length <= 42))); }
{ const w = (x, s, e) => ({ w: x, start: s, end: e }); const r = normalizeCues([{ ...C(0, 0.4, 'aa'), words: [[w('aa', 0, 0.4)]] }, { ...C(0.4, 0.8, 'bb'), words: [[w('bb', 0.4, 0.8)]] }], { minDur: 0.8, totalEnd: 0.8 });
  t('merge concatenates karaoke word timings', r.length === 1 && r[0].words.flat().map(x => x.w).join() === 'aa,bb'); }
{ const r = normalizeCues([C(0, 1, 'a'), C(1.5, 1.7, 'b'), C(2.2, 4, 'c')], { minDur: 0.8 }); t('uses free gaps first, neighbours untouched when gaps suffice', r[0].end === 1 && r[2].start === 2.2 && minOk(r, 0.8) && noOverlap(r), JSON.stringify(r)); }
{ const inp = [C(0, 0.3), C(0.3, 3)]; normalizeCues(inp, { minDur: 0.8 }); t('input not mutated', inp[0].end === 0.3); }
// ---- buildSrt for both presets, word length 64/100, Latin + Cyrillic, short & normal story durations
for (const [name, maxChars] of [['16:9', 46], ['9:16', 28]]) for (const w of [L64, L100, C64, C100]) for (const dur of [6, 12, 30]) {
  const txt = `Новость: ${w} сегодня. NASA ${w} end.`; const srt = buildSrt([{ text: txt, start: 0.25, duration: dur }], { maxChars }); // defaults as in factory2
  const v = validateSrt(srt, { maxChars, totalSec: dur + 1 }); const cs = parseSrt(srt);
  t(`buildSrt ${name} ${Array.from(w).length}ch ${/[а-я]/i.test(w) ? 'cyr' : 'lat'} ${dur}s: valid, all >= 0.8s`, v.ok && cs.every(c => c.end - c.start >= 0.8 - 1e-3), v.errors.slice(0, 3).join('; ')); }
// The exact F-1 shape: 16:9, 64-char word in a short story → previously «cue 7: too short 0.48s»
{ const txt = `NASA reports ${L64} progress. Details at https://www.nasa.gov/news-release/artemis-ii-crew-completes-final-simulation-2026/ today. Это ${C64} пример конец.`;
  const srt = buildSrt([{ text: txt, start: 0.25, duration: 9.4 }], { maxChars: 46 }); const v = validateSrt(srt, { maxChars: 46, totalSec: 11 }); t('F-1 shape (16:9, 64ch, tight story) valid', v.ok, v.errors.join('; ')); }
// ---- REAL renders
if (!process.env.PW_FILE) console.log('SKIP real renders: set PW_FILE');
else {
  const OUT = process.env.OUTDIR || '/workspace/out/e2e-artifacts/final'; fs.mkdirSync(OUT, { recursive: true });
  const B = process.env.STUDIO_URL || 'http://127.0.0.1:8687'; const pw = fs.readFileSync(process.env.PW_FILE, 'utf8').trim(); let cookie = '';
  const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-studio-request': '1', origin: B, cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
  await call('POST', '/api/auth/login', { username: 'igor', password: pw });
  let c = (await call('GET', '/api/newsvideo/stories')).j.candidates; if (!c.length) c = (await call('POST', '/api/newsvideo/search')).j.candidates;
  for (const [tag, A, Bw] of [['w64', L64, C64], ['w100', L100, C100]]) {
    const d = (await call('POST', '/api/newsvideo/drafts', { storyIds: [c[0].id] })).j; t(`real ${tag}: draft created`, d && d.id, d && d.error); if (!d || !d.id) continue;
    const TEXT = `NASA reports ${A} progress today. Это ${Bw} пример конец.`;
    await call('PUT', `/api/newsvideo/drafts/${d.id}`, { title: 'F-1 ' + tag, stories: [{ id: d.stories[0].id, headline: 'F-1 long word ' + tag, text: TEXT }] });
    for (const [preset, WH, max] of [['youtube', '1920,1080', 46], ['shorts', '1080,1920', 28]]) {
      const h = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j.contentHash; const a = await call('POST', `/api/newsvideo/drafts/${d.id}/approve`, { factChecked: true, contentHash: h }); if (a.j.status !== 'approved' && a.j.status !== 'rendered') t(`real ${tag} ${preset}: approved`, false, a.j.error);
      const r = await call('POST', `/api/newsvideo/drafts/${d.id}/render`, { preset }); t(`real ${tag} ${preset}: render started`, r.j && r.j.status === 'rendering', r.j && r.j.error);
      let g; for (let i = 0; i < 180; i++) { await new Promise(z => setTimeout(z, 5000)); g = (await call('GET', `/api/newsvideo/drafts/${d.id}`)).j; if (g.status !== 'rendering') break; }
      t(`real ${tag} ${preset}: rendered (no «too short»)`, g.status === 'rendered', g.status + ' ' + (g.renders.at(-1).error || ''));
      if (g.status !== 'rendered') continue;
      const base = path.join(OUT, `f1_${tag}_${preset === 'youtube' ? '16x9' : '9x16'}`);
      fs.writeFileSync(base + '.mp4', Buffer.from(await (await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=mp4&download=1`, { headers: { cookie } })).arrayBuffer()));
      const pr = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'default=nw=1', base + '.mp4']).toString(); fs.writeFileSync(base + '.ffprobe.txt', pr);
      t(`real ${tag} ${preset}: MP4 ${WH}`, pr.includes('width=' + WH.split(',')[0]) && pr.includes('height=' + WH.split(',')[1]) && /codec_type=audio/.test(pr), base + '.mp4');
      const srt = await (await fetch(`${B}/api/newsvideo/drafts/${d.id}/file?kind=srt&download=1`, { headers: { cookie } })).text(); fs.writeFileSync(base + '.srt', srt);
      const v = validateSrt(srt, { maxChars: max, minDur: 0.8 }); t(`real ${tag} ${preset}: SRT valid, every cue >= 0.8s, lines <= ${max}`, v.ok, v.errors.slice(0, 3).join('; '));
      t(`real ${tag} ${preset}: long word present (split)`, srt.replace(/-?\n/g, '').includes(A.slice(0, 20)) && srt.includes(Bw.slice(0, 10)));
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
