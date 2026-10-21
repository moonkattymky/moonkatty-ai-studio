'use strict';
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const COMMON = new Set(('The A An In On At For And But Or Of To By With From As It Its This That These Those He She They We You I Here Today ' +
  'Officials Police Scientists Researchers Experts Breaking New After Before Over Under Meanwhile Also According Monday Tuesday Wednesday Thursday Friday Saturday Sunday Good Evening Welcome Stay Tuned Thanks Watching News Story Stories Update Report Reports Top More Next Now There What When Where Why How Who').split(' '));
const norm = s => String(s).toLowerCase().replace(/[’']/g, "'");
/** Extract checkable facts: numbers, proper names (capitalized tokens), dates (month names, years). */
function extractFacts(text) {
  const t = String(text);
  const numbers = [...new Set((t.match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, '')))];
  const dates = [...new Set((t.match(new RegExp(`\\b(${MONTHS})\\b`, 'gi')) || []).map(norm))];
  const names = [...new Set((t.match(/\b[A-Z][a-zA-Z\-]{1,}\b/g) || []).filter(w => !COMMON.has(w) && !new RegExp(`^(${MONTHS})$`, 'i').test(w)))];
  return { numbers, dates, names };
}
/** Returns { ok, unsupported:[...] } — every fact in output must occur in sources (or in the allow list e.g. brand names). */
function checkAgainstSources(output, sources, { allow = ['MOONKATTY'], checkNames = true } = {}) {
  const src = norm([].concat(sources).join(' \n '));
  const srcNums = new Set((src.match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, '')));
  const allowed = new Set(allow.map(norm));
  const f = extractFacts(output); const unsupported = [];
  for (const n of f.numbers) if (!srcNums.has(n)) unsupported.push({ type: 'number', value: n });
  for (const d of f.dates) if (!src.includes(d)) unsupported.push({ type: 'date', value: d });
  if (checkNames) for (const n of f.names) if (!allowed.has(norm(n)) && !src.includes(norm(n))) unsupported.push({ type: 'name', value: n });
  return { ok: unsupported.length === 0, unsupported };
}
const NUM_WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands|million|millions|billion|billions|dozen|dozens|half|double|triple|first|second|third|percent';
const REL_TIME = "just (?:whipped|hit|swept|passed|landed|launched|happened)|(?:is|are|was) now|now (?:whipping|sweeping|moving|heading)|developing|stay tuned|updates?|recently|currently|right now|just now|this weekend|yesterday|tomorrow|tonight|last week|next week|last month|next month|last year|next year|this morning|this week|this year|earlier today|years? ago|decades? ago|centur(?:y|ies)";
let DICT = null, PROPER = null; function isDictWord(w) { if (!DICT) { DICT = new Set(); PROPER = new Set(); try { for (const l of require('fs').readFileSync(process.env.MA_DICT || '/usr/share/dict/words', 'utf8').split('\n')) (/^[a-z]/.test(l) ? DICT : PROPER).add(l.trim()); } catch { /* no dictionary -> OPENERS only */ } }
  if (PROPER.has(w.replace(/[’'].*$/, ''))) return false; // also a proper noun (Smith, Paris) -> must be in SOURCE
  const x = w.toLowerCase().replace(/[’']/g, "'"); return DICT.has(x) || DICT.has(x.replace(/'(re|s|ll|ve|d|t)$/, '')) || DICT.has(x.replace(/n't$/, '')); }
/** Sentence-initial discourse words an anchor may use (not names). */
const OPENERS = new Set(('So Now Picture Imagine Well Okay Ok Folks Friends Meanwhile Hold Get Let Let\'s Buckle Big Hello Hi Hey Our Your Up Next First Finally Turns Think Just Not Yes No Wow Speaking Back Stay Ever Ready Time Even Still Yet Plus Fun Here\'s It\'s That\'s What\'s There\'s Who\'s Talk Grab Keep Coming Right Oh Alright All Quick Kind Bottom Short Long Good Great Sounds Looks Seems Engineers Spacecraft Rotorcraft Using By Instead Because While If Once Whether Their His Her One Some Many Most Every Each Both Another Such Only Then Than Until Unless Science Researchers').split(' '));
/**
 * Strict fact-preservation check for anchor scripts: everything checkAgainstSources checks PLUS spelled-out numbers / ordinals,
 * relative dates ("yesterday", "last week") and capitalised words anywhere (sentence-initial words only exempt if in OPENERS).
 */
function strictFactCheck(output, sources, { allow = ['MOONKATTY', 'NEWS', 'Katty'] } = {}) {
  const src = norm([].concat(sources).join(' \n ')); const base = checkAgainstSources(output, sources, { allow, checkNames: false }); const unsupported = [...base.unsupported];
  for (const m of String(output).matchAll(new RegExp(`\\b(${NUM_WORDS})\\b`, 'gi'))) if (!new RegExp(`\\b${m[1].toLowerCase()}\\b`).test(src)) unsupported.push({ type: 'number-word', value: m[1] });
  for (const m of String(output).matchAll(new RegExp(`\\b(${REL_TIME})\\b`, 'gi'))) if (!src.includes(m[1].toLowerCase())) unsupported.push({ type: 'relative-date', value: m[1] });
  const allowed = new Set(allow.map(norm));
  for (const sent of String(output).split(/(?<=[.!?…])\s+|\n+/)) {
    const toks = [...sent.matchAll(/\b([A-Z][\w'’-]*)/g)];
    toks.forEach((m, i) => { const w = m[1].replace(/[’']s?$/, ''); const initial = m.index === sent.search(/[A-Za-z]/);
      if (initial && (OPENERS.has(m[1].replace('’', "'")) || isDictWord(m[1]))) return; /* sentence-initial ordinary English word */ if (COMMON.has(w) && !initial) return; if (initial && COMMON.has(w)) return;
      if (allowed.has(norm(w)) || src.includes(norm(w))) return; unsupported.push({ type: 'name', value: w }); });
  }
  const seen = new Set(); const uniq = unsupported.filter(u => { const k = u.type + u.value.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: uniq.length === 0, unsupported: uniq };
}
module.exports = { extractFacts, checkAgainstSources, strictFactCheck };
