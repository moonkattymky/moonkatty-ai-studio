'use strict';
const SCALE = { billion: 'BN', million: 'M', thousand: 'K', trillion: 'TN' };
const UNIT_OK = /^(km|kilometers?|kilometres?|miles?|people|percent|%|dollars?|euros?|tons?|tonnes?|kg|meters?|metres?|feet|degrees?|years?|days?|hours?|satellites?|astronauts?|countries|species|jobs|homes|patients|cases|students|flights?|launches|missions?)$/i;
/** Pick one verifiable number from source texts (never from LLM output). Returns {value,label,source} or null. */
function pickFact(items) {
  for (const it of items) {
    const text = `${it.title}. ${it.summary || ''}`;
    for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(billion|million|thousand|trillion)?\s*(%|[A-Za-z]+)/g)) {
      const [, num, scale, unit] = m; if (/^(19|20)\d\d$/.test(num) && !scale) continue; if (!UNIT_OK.test(unit)) continue;
      const value = `${num}${scale ? ' ' + SCALE[scale.toLowerCase()] : ''}${unit === '%' || /^percent$/i.test(unit) ? '%' : ''}`;
      const label = unit === '%' || /^percent$/i.test(unit) ? 'percent' : unit;
      return { value, label, source: it.sourceName || it.sourceId, quote: m[0] };
    }
  }
  return null;
}
const STOP = new Set('a an the of in on at to for and or is are was were be by with from as after over new says said its it this that will has have how why what nasa’s nasa\'s'.split(' '));
const VERBS = new Set('provides progress update marks start reveals reveal finds find tracks track declared ready sets set captures capture announces announce launches begins begin says shows show helps help new first latest more could would after before during about into amid'.split(' '));
function mediaQueries(story) {
  const words = String(story.headline || story.title).replace(/[’']s\b/g, '').split(/[^A-Za-z0-9-]+/).filter(w => w.length > 2 && !STOP.has(w.toLowerCase()) && !VERBS.has(w.toLowerCase()));
  const q1 = words.slice(-3).join(' '); const q2 = words.slice(0, 3).join(' ');
  const space = ['space', 'science'].includes(story.category) || /nasa|esa|mars|moon|orbit|rocket|telescope|asteroid|planet|jupiter|spacecraft|webb|hubble|comet|galaxy|solar/i.test(story.headline);
  const prov = space ? ['nasa', 'commons'] : ['commons', 'nasa'];
  const hasProper = q => /(^|\s)[A-Z][A-Za-z0-9-]{3,}/.test(q); let qs = [...new Set([q1, q2].filter(Boolean))];
  if (qs.some(hasProper)) qs = qs.filter(hasProper); // never search with only generic words (avoids e.g. a car photo for a Mars cloud story)
  return qs.flatMap(q => prov.map(provider => ({ provider, q })));
}
const GEN_PROPER = new Set(['NASA', 'ESA', 'The', 'A', 'An', 'In', 'On', 'At', 'This', 'It', 'Scientists', 'Researchers', 'Earth', 'Space', 'Image', 'Credit', 'October', 'November', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
/** Strict media plan (News 2.0): story-specific proper nouns (place after a preposition in the headline, names capitalised mid-sentence in the source summary). An image must mention one. */
function strictMediaPlan(story) {
  const text = `${story.summary || ''} ${(story.items || []).map(i => i.summary || '').join(' ')}`; const head = String(story.headline || '');
  const mid = [...text.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-zA-Z0-9-]{2,}(?:\s+[A-Z][a-zA-Z0-9-]{2,})*)/g)].flatMap(m => m[1].split(/\s*\b[A-Za-z]+-(?:led|based|built)\b\s*/)).map(w => w.trim()).filter(w => w.length > 2 && !GEN_PROPER.has(w)); // multi-word names kept whole ("Solar Orbiter")
  const postPrep = [...head.matchAll(/\b(?:Past|Over|In|At|Near|Off|Across|From|To|On)\s+([A-Z][a-zA-Z-]{2,})/g)].map(m => m[1]); // Title-Case headlines: place after preposition
  const BROADP = new Set(['North', 'South', 'East', 'West', 'Hurricane', 'Storm', 'Mars', 'Moon', 'Sun']);
  const requireAny = [...new Set([...postPrep, ...mid.filter(w => head.toLowerCase().includes(w.toLowerCase()))])].filter(w => !GEN_PROPER.has(w) && !BROADP.has(w));
  const words = head.replace(/[’']s\b/g, '').split(/[^A-Za-z0-9-]+/).filter(w => w.length > 2 && !STOP.has(w.toLowerCase()) && !VERBS.has(w.toLowerCase()) && !GEN_PROPER.has(w) && !/^(apod|experimental|target|longer|whips|oddest|even|than|thought)$/i.test(w));
  const bigrams = words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`); // adjacent content words, e.g. "Mars Helicopter"
  const base0 = mediaQueries(story); const provs = [...new Set(base0.map(b => b.provider))];
  const base = [...bigrams.slice(0, 3).flatMap(q => provs.map(provider => ({ provider, q }))), ...base0]; if (!requireAny.length) return { queries: base, requireAny };
  const content = head.split(/[^A-Za-z-]+/).filter(w => w.length > 4 && !requireAny.includes(w) && !STOP.has(w.toLowerCase()) && !VERBS.has(w.toLowerCase()) && !/^(whips|hits|slams|gets|takes)$/i.test(w));
  const prov = [...new Set(base.map(b => b.provider))];
  const extra = requireAny.slice(0, 3).flatMap(t => [...(t.includes(" ") ? [t] : []), ...content.filter(c => !t.includes(c)).slice(0, 2).map(c => `${t} ${c}`)]).slice(0, 5).flatMap(q => prov.map(provider => ({ provider, q })));
  return { queries: [...extra, ...base], requireAny };
}
module.exports = { pickFact, mediaQueries, strictMediaPlan };
