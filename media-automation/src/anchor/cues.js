'use strict';
/** Word timestamps + animation cue generator (contract: docs/media-automation/ANIMATION_CUES.md, schema config/animation-cues.schema.json). */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { prosody } = require('./emotion');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'animation-cues.schema.json'), 'utf8'));
/**
 * Word timestamps from MEASURED sentence boundaries (Kokoro bridge) — inside a sentence words are spread by weight
 * (letters + 2, commas add a short gap). Approximate (±~120 ms inside long sentences), exact at sentence edges.
 */
function wordTimestamps(sentences, offset = 0) {
  const out = [];
  for (const s of sentences) {
    const words = s.text.split(/\s+/).filter(Boolean); const wt = words.map(w => w.replace(/[^A-Za-z0-9]/g, '').length + 2 + (/[,;:]$/.test(w) ? 3 : 0));
    const tot = wt.reduce((a, b) => a + b, 0) || 1; const span = s.end - s.start; let t = s.start;
    words.forEach((w, i) => { const d = span * wt[i] / tot; const gap = /[,;:]$/.test(w) ? d * 0.25 : 0; out.push({ w, start: +(t + offset).toFixed(3), end: +(t + d - gap + offset).toFixed(3) }); t += d; });
  }
  return out;
}
const PAW = new Set(['rest', 'paws_open', 'paw_wave', 'paws_together', 'paw_point', 'paw_tap_desk']); // head_tilt/ear_flick modes go to head/ears tracks
const rnd = (seed, i) => crypto.createHash('md5').update(seed + ':' + i).digest()[0] / 255;
/** Build a cue document for one segment. sentences: measured [{text,start,end}] relative to segment audio start; offset = segment start in the episode. */
function buildCues({ segmentId, audio, text, emotion, sentences, offset = 0, humorTag = null }) {
  const p = prosody(emotion); const words = wordTimestamps(sentences, offset); const dur = audio.durationSec; const end = offset + dur;
  const pauses = []; for (let i = 0; i < sentences.length - 1; i++) pauses.push({ start: +(sentences[i].end + offset).toFixed(3), end: +(sentences[i + 1].start + offset).toFixed(3),
    kind: emotion === 'WITTY' && i === sentences.length - 2 ? 'punchline' : 'sentence' });
  const calm = ['SERIOUS', 'EMPATHETIC'].includes(emotion);
  const smile = [{ t: +offset.toFixed(3), value: p.smile, easeSec: 0.4 }];
  if (humorTag && !calm) { const last = sentences[sentences.length - 1]; smile.push({ t: +(last.start + offset).toFixed(3), value: Math.min(1, p.smile + 0.3), easeSec: 0.3 }); }
  const blinks = []; for (let t = offset + 0.8, i = 0; t < end - 0.3; i++) { blinks.push({ t: +t.toFixed(3), durationSec: 0.15 }); t += (1 / p.blinkRate) * (0.7 + 0.6 * rnd(segmentId, i)); }
  const gestures = []; const head = []; const ears = [];
  sentences.forEach((s, i) => { const t0 = s.start + offset, t1 = Math.min(s.end + offset, t0 + 1.6);
    if (PAW.has(p.gesture) && (i === 0 || i % 2 === 0)) gestures.push({ start: +t0.toFixed(3), end: +t1.toFixed(3), type: p.gesture, side: i % 4 === 2 ? 'left' : 'right' });
    head.push({ t: +t0.toFixed(3), move: emotion === 'CURIOUS' && /\?/.test(s.text) ? 'tilt_right' : i === 0 ? 'turn_camera' : 'nod', amount: calm ? 0.2 : 0.5 });
    if (!calm && ['WITTY', 'PLAYFUL', 'EXCITED', 'CURIOUS'].includes(emotion) && i === sentences.length - 1) ears.push({ t: +t0.toFixed(3), move: emotion === 'WITTY' ? 'flick' : 'perk' }); });
  if (calm) ears.push({ t: +offset.toFixed(3), move: 'flatten_soft' });
  return { version: '1', segmentId, offsetSec: +offset.toFixed(3), audio, text, emotion: { mode: emotion, intensity: calm ? 0.4 : 0.7 }, words, pauses, smile, blinks, gestures, head, ears };
}
/** Minimal JSON-Schema (draft 2020-12 subset: type, required, properties, items, enum, const, minimum, maximum) validator — zero deps. */
function validate(doc, schema = SCHEMA, at = '$') {
  const errs = []; const ty = v => Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
  if (schema.const !== undefined && doc !== schema.const) errs.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(doc)) errs.push(`${at}: ${JSON.stringify(doc)} not in enum`);
  if (schema.type) { const t = ty(doc); if (!(t === schema.type || (schema.type === 'number' && t === 'integer'))) { errs.push(`${at}: expected ${schema.type}, got ${t}`); return errs; } }
  if (typeof doc === 'number') { if (schema.minimum !== undefined && doc < schema.minimum) errs.push(`${at}: < ${schema.minimum}`); if (schema.maximum !== undefined && doc > schema.maximum) errs.push(`${at}: > ${schema.maximum}`); }
  if (ty(doc) === 'object') { for (const r of schema.required || []) if (!(r in doc)) errs.push(`${at}: missing ${r}`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in doc) errs.push(...validate(doc[k], s, `${at}.${k}`)); }
  if (Array.isArray(doc) && schema.items) doc.forEach((x, i) => errs.push(...validate(x, schema.items, `${at}[${i}]`)));
  return errs;
}
/** Schema + semantic checks (monotonic words, all times within audio). */
function checkCues(doc, { offset = doc.offsetSec || 0 } = {}) {
  const errs = validate(doc); if (errs.length) return { ok: false, errors: errs };
  const end = offset + doc.audio.durationSec + 0.05;
  doc.words.forEach((w, i) => { if (w.end < w.start) errs.push(`word ${i} end<start`); if (i && w.start < doc.words[i - 1].start) errs.push(`word ${i} not monotonic`); if (w.end > end) errs.push(`word ${i} beyond audio`); });
  for (const k of ['blinks', 'smile', 'head', 'ears']) (doc[k] || []).forEach((c, i) => { if (c.t > end) errs.push(`${k}[${i}] beyond audio`); });
  if (['SERIOUS', 'EMPATHETIC'].includes(doc.emotion.mode) && doc.smile.some(s => s.value > 0.1)) errs.push('calm mode must not smile > 0.1');
  return { ok: errs.length === 0, errors: errs };
}
module.exports = { wordTimestamps, buildCues, validate, checkCues, SCHEMA };
