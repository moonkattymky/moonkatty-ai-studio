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
  return [...new Set([q1, q2].filter(Boolean))].flatMap(q => prov.map(provider => ({ provider, q })));
}
module.exports = { pickFact, mediaQueries };
