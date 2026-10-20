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
module.exports = { extractFacts, checkAgainstSources };
