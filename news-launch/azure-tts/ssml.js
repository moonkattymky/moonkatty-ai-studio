'use strict';
const { DEFAULT_VOICE } = require('./budget');

/** Alias both the written name and the lexicon form "Moon Katty". */
const DEFAULT_PRONUNCIATIONS = Object.freeze([
  { text: 'Moon Katty', alias: 'moon-KAT-ee' },
  { text: 'MOONKATTY', alias: 'moon-KAT-ee' },
]);

const PHONEME_ALPHABETS = new Set(['ipa', 'sapi', 'ups', 'x-sampa']);

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

/** UTF-16 code units of the caller text. A local guard, not Microsoft's meter. */
function countChars(text) {
  return String(text).length;
}

function rateAttribute(rate) {
  if (rate == null || rate === '' || rate === 1 || rate === '1') return null;
  if (typeof rate === 'number') {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Azure Speech rate is invalid. Refusing to run.');
    return `${Math.round(rate * 100)}%`;
  }
  const s = String(rate).trim();
  if (!/^[+-]?\d+(\.\d+)?%$/.test(s)) throw new Error('Azure Speech rate is invalid. Refusing to run.');
  return s;
}

function renderPronunciation(entry) {
  if (entry.alias != null && (entry.alphabet != null || entry.ph != null)) {
    throw new Error('Azure Speech pronunciation must be an alias or a phoneme, not both. Refusing to run.');
  }
  if (entry.alias != null) return `<sub alias="${escapeXml(entry.alias)}">${escapeXml(entry.text)}</sub>`;
  if (entry.ph != null) {
    const alphabet = entry.alphabet || 'ipa';
    if (!PHONEME_ALPHABETS.has(alphabet)) throw new Error('Azure Speech phoneme alphabet is invalid. Refusing to run.');
    if (!String(entry.ph)) throw new Error('Azure Speech phoneme is empty. Refusing to run.');
    return `<phoneme alphabet="${alphabet}" ph="${escapeXml(entry.ph)}">${escapeXml(entry.text)}</phoneme>`;
  }
  throw new Error('Azure Speech pronunciation is incomplete. Refusing to run.');
}

function applyMarkup(text, pronunciations) {
  const entries = [...pronunciations].filter(e => e && e.text).sort((a, b) => b.text.length - a.text.length);
  let out = '';
  for (let i = 0; i < text.length;) {
    const pause = /^\[pause\s+(\d+)\s*(?:ms)?\]/i.exec(text.slice(i));
    if (pause) {
      const ms = Number(pause[1]);
      if (ms > 600000) throw new Error('Azure Speech pause is longer than the 10 minute request limit. Refusing to run.');
      out += `<break time="${ms}ms"/>`;
      i += pause[0].length;
      continue;
    }
    let hit = null;
    for (const entry of entries) {
      if (!text.startsWith(entry.text, i)) continue;
      const beforeOk = i === 0 || /[^\w]/.test(text[i - 1]);
      const after = i + entry.text.length;
      const afterOk = after === text.length || /[^\w]/.test(text[after]);
      if (beforeOk && afterOk) { hit = entry; break; }
    }
    if (hit) { out += renderPronunciation(hit); i += hit.text.length; continue; }
    out += escapeXml(text[i]);
    i += 1;
  }
  return out;
}

function buildSsml(text, { voice = DEFAULT_VOICE, rate = null, pronunciations = DEFAULT_PRONUNCIATIONS } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(String(voice))) throw new Error('Azure Speech voice name is invalid. Refusing to run.');
  const inner = applyMarkup(String(text), pronunciations);
  const paced = rateAttribute(rate);
  const body = paced ? `<prosody rate="${escapeXml(paced)}">${inner}</prosody>` : inner;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${escapeXml(voice)}">${body}</voice></speak>`;
}

module.exports = { DEFAULT_PRONUNCIATIONS, buildSsml, countChars, escapeXml, rateAttribute };
