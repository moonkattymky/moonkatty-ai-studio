/**
 * Deterministic extractors for quotes, dates and numbers.
 * No network and no model. Used by the script checker.
 */

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

const MONTH_PATTERN = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

const STOP = new Set('the a an and or of to in on for with from by at as is was were said says that this these those after before over into about its their his her'.split(' '));

const SCALES = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

export function contentWords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.filter(w => w.length > 2 && !STOP.has(w));
}

export function overlap(claim, sourceText) {
  const left = contentWords(claim);
  if (!left.length) return 0;
  const right = new Set(contentWords(sourceText));
  return left.filter(w => right.has(w)).length / left.length;
}

export function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

export function extractQuotes(text) {
  const out = [];
  const re = /"([^"]{12,})"|“([^”]{12,})”|«([^»]{12,})»/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    out.push((match[1] || match[2] || match[3]).replace(/\s+/g, ' ').trim());
  }
  return out;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function extractDates(text) {
  const src = String(text || '');
  const out = [];
  let match;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((match = iso.exec(src))) out.push(`${match[1]}-${match[2]}-${match[3]}`);
  const dmy = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'gi');
  while ((match = dmy.exec(src))) {
    const month = MONTHS[match[2].toLowerCase()];
    if (month) out.push(`${match[3]}-${pad(month)}-${pad(match[1])}`);
  }
  const mdy = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2}),\\s*(\\d{4})\\b`, 'gi');
  while ((match = mdy.exec(src))) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month) out.push(`${match[3]}-${pad(month)}-${pad(match[2])}`);
  }
  return [...new Set(out)];
}

function dateSpans(text) {
  const spans = [];
  const re = new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s+\\d{4}|(?:${MONTH_PATTERN})\\s+\\d{1,2},\\s*\\d{4})\\b`, 'gi');
  let match;
  while ((match = re.exec(text))) spans.push([match.index, match.index + match[0].length]);
  return spans;
}

export function extractNumbers(text) {
  const src = String(text || '');
  const spans = dateSpans(src);
  const out = [];
  const re = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)?/gi;
  let match;
  while ((match = re.exec(src))) {
    const digitAt = match[0].search(/\d/);
    const start = match.index + (digitAt < 0 ? 0 : digitAt);
    const end = match.index + match[0].length;
    if (spans.some(([a, b]) => start >= a && start < b)) continue;
    if (src[end] === ':' || src[start - 1] === ':') continue;
    const raw = match[1].replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const scaleWord = match[2] ? match[2].toLowerCase() : '';
    const scale = scaleWord ? SCALES[scaleWord] : 1;
    if (!scaleWord && !match[0].includes('$') && n >= 1900 && n <= 2100 && raw.length === 4) continue;
    out.push({
      display: match[0].replace(/\s+/g, ' ').trim(),
      value: n * scale,
      index: start
    });
  }
  return out;
}

export function sameNumber(a, b) {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale < 0.011;
}

export function sourceBlob(source) {
  return `${source.title || ''}\n${source.text || ''}`;
}
