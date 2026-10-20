'use strict';
const crypto = require('crypto');
const { tokens, jaccard } = require('../../media-automation/src/news/dedup');
const { categorize, isControversial } = require('../../media-automation/src/news/classify');
const { assertSchema, SCHEMAS } = require('./schemas');

const STOP = new Set('this that with from have been were said says after will into over under about their there they them your more most some other than then also just news report reports reported according officials official people world today yesterday tomorrow week month year'.split(' '));
const COMMON_ANCHORS = new Set('united states president government minister china russia ukraine israel gaza america american british britain france germany india trump monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'.split(' '));

function contentTokens(text) {
  return [...tokens(text)].filter(w => w.length >= 4 && !STOP.has(w));
}
function anchorsOf(text) {
  const raw = String(text || '');
  const caps = [...raw.matchAll(/\b[A-Z][A-Za-z0-9]{3,}\b/g)].map(m => m[0].toLowerCase());
  const nums = [...raw.matchAll(/\b\d[\d,.]{1,}\b/g)].map(m => m[0].replace(/[.,]/g, '')).filter(n => n.length >= 2 && !/^20(2[4-9])$/.test(n));
  const long = contentTokens(raw).filter(w => w.length >= 6);
  return [...new Set([...caps, ...nums, ...long])];
}
function rareAnchors(text) {
  return anchorsOf(text).filter(a => !COMMON_ANCHORS.has(a) && !STOP.has(a));
}
function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function numberTokens(text) {
  return [...String(text || '').matchAll(/\b\d[\d,]*/g)].map(m => m[0].replace(/,/g, '')).filter(n => !/^20\d\d$/.test(n));
}
/** Different casualty or money figures mean the items are not the same claim. */
function numbersConflict(a, b) {
  const left = numberTokens(`${a.title} ${a.summary}`);
  const right = numberTokens(`${b.title} ${b.summary}`);
  if (!left.length || !right.length) return false;
  return left.some(n => !right.includes(n)) && right.some(n => !left.includes(n));
}
function anchorList(text) {
  return [...new Set(contentTokens(text).filter(w => w.length >= 6 && !COMMON_ANCHORS.has(w)))];
}
function documentFrequency(items) {
  const df = new Map();
  for (const it of items) for (const a of anchorList(`${it.title} ${it.summary}`)) df.set(a, (df.get(a) || 0) + 1);
  return df;
}
function sharedDistinctive(a, b, df, maxDf = 8) {
  const left = new Set(anchorList(`${a.title} ${a.summary}`).filter(w => (df.get(w) || 1) <= maxDf));
  return anchorList(`${b.title} ${b.summary}`).filter(w => left.has(w) && (df.get(w) || 1) <= maxDf);
}

/**
 * Same organisation never counts. A News Engine cluster counts when the titles
 * do not disagree on figures. Otherwise the temporary adapter requires several
 * distinctive words plus similar titles, so a shared topic is not enough.
 */
function related(a, b, df = null) {
  if (!a.org || !b.org || a.org === b.org) return false;
  if (a.url && a.url === b.url) return false;
  if (numbersConflict(a, b)) return false;
  if (a.engineStoryId && a.engineStoryId === b.engineStoryId) return true;
  const freq = df || documentFrequency([a, b]);
  const shared = sharedDistinctive(a, b, freq);
  const jac = jaccard(new Set(contentTokens(a.title)), new Set(contentTokens(b.title)));
  if (shared.length >= 3 && jac >= 0.15) return true;
  if (shared.length >= 2 && jac >= 0.28) return true;
  return false;
}

function groupItems(items) {
  const df = documentFrequency(items);
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (related(items[i], items[j], df)) union(i, j);
  }
  const buckets = new Map();
  items.forEach((it, i) => {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(it);
  });
  return [...buckets.values()];
}

const URL_GENERIC = new Set('news world article articles international video story stories wirestory index politics science confirms records capital amid concerns about after first their from with daily'.split(' '));
function urlAgrees(title, url) {
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return false; }
  const words = pathname.split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !/\d/.test(w) && !URL_GENERIC.has(w));
  if (words.length < 2) return true;
  const titleWords = [...tokens(title)];
  const hit = words.filter(w => titleWords.some(t => t === w || (Math.min(t.length, w.length) >= 5 && (t.startsWith(w) || w.startsWith(t)))));
  return hit.length * 2 >= words.length;
}
function sameClaim(primary, other, df) {
  if (!primary || !other) return false;
  if (numbersConflict(primary, other)) return false;
  if (!urlAgrees(other.title, other.url) || !urlAgrees(primary.title, primary.url)) return false;
  if (primary.engineStoryId && primary.engineStoryId === other.engineStoryId) return true;
  const jac = jaccard(tokens(primary.title), tokens(other.title));
  return jac >= 0.42 && related(primary, other, df);
}

function pickPerOrg(group) {
  const by = new Map();
  for (const it of group) {
    if (!it.org || !it.url || !it.title) continue;
    const score = (it.summary || '').length + it.title.length;
    const cur = by.get(it.org);
    if (!cur || score > cur.score) by.set(it.org, { ...it, score });
  }
  return [...by.values()].map(({ score, ...it }) => it);
}

/**
 * Union-find can pull a long unrelated headline into the same bucket.
 * Keep every coherent subset, largest publisher count first, instead of
 * discarding a real cluster because another title in the bucket is longer.
 */
function extractCoherent(group, df) {
  const remaining = group.slice();
  const clusters = [];
  while (remaining.length) {
    let best = [];
    let bestOrgs = -1;
    for (const primary of remaining) {
      const coherent = remaining.filter(it => it === primary || sameClaim(primary, it, df));
      const orgs = new Set(coherent.map(s => s.org).filter(Boolean)).size;
      if (orgs > bestOrgs || (orgs === bestOrgs && coherent.length > best.length)) {
        best = coherent;
        bestOrgs = orgs;
      }
    }
    if (!best.length) break;
    clusters.push(best);
    const drop = new Set(best);
    for (let i = remaining.length - 1; i >= 0; i--) if (drop.has(remaining[i])) remaining.splice(i, 1);
  }
  return clusters;
}

function factCheckItems(items, { now = () => new Date().toISOString() } = {}) {
  const checkedAt = now();
  const df = documentFrequency(items);
  return groupItems(items).flatMap(group => extractCoherent(group, df).map(coherent => {
    const sources = pickPerOrg(coherent).map(s => ({
      org: s.org, publisher: s.publisher, url: s.url, title: s.title,
      summary: s.summary || '', published: parseDate(s.published), sourceId: s.sourceId,
      engineStoryId: s.engineStoryId || null,
    }));
    const orgs = new Set(sources.map(s => s.org));
    const text = sources.map(s => `${s.title} ${s.summary}`).join(' ');
    const sameEngine = sources.length > 0 && sources.every(it => it.engineStoryId && it.engineStoryId === sources[0].engineStoryId);
    const adapter = sameEngine ? null : 'TEMPORARY_ADAPTER:distinctive-anchor-corroboration';
    const dates = sources.map(s => s.published).filter(Boolean).sort();
    const confirmed = orgs.size >= 2;
    const result = {
      storyId: crypto.createHash('sha1').update(sources.map(s => s.url).sort().join('|') || group[0].title).digest('hex').slice(0, 12),
      claim: sources.slice().sort((a, b) => b.title.length - a.title.length)[0]?.title || group[0].title,
      status: confirmed ? 'confirmed' : 'rejected',
      rejectionReason: confirmed ? null : 'fewer_than_two_independent_publishers',
      sources,
      independentPublishers: orgs.size,
      checkedAt,
      method: sameEngine ? 'news-engine-cluster' : 'temporary-adapter:distinctive-anchor-corroboration',
      adapter,
      category: categorize(text),
      controversial: coherent.some(it => it.controversial) || isControversial(text),
      breaking: coherent.some(it => it.breaking),
      publishedAt: dates.length ? dates[dates.length - 1] : null,
      primarySourceUrl: null,
      primaryPublisher: null,
      primaryPublished: null,
      editorialStatus: confirmed ? 'confirmed-publishers' : 'dropped-unconfirmed',
    };
    return assertSchema(result, SCHEMAS.factCheck, 'FactCheckResult');
  }));
}

function selectStories(results, { count = 3, maxAgeHours = 96, now = Date.now() } = {}) {
  const grim = /child|children|murder|rape|sexual|massacre/i;
  const confirmed = results.filter(r => r.status === 'confirmed' && r.independentPublishers >= 2 && r.sources.length >= 2
    && !grim.test([r.claim, ...r.sources.map(s => `${s.title} ${s.summary || ''}`)].join(' ')));
  const ageHours = r => (r.publishedAt ? (now - Date.parse(r.publishedAt)) / 36e5 : Infinity);
  let pool = confirmed.filter(r => ageHours(r) <= maxAgeHours);
  let window = maxAgeHours;
  if (pool.length < count) { pool = confirmed.filter(r => ageHours(r) <= 168); window = 168; }
  if (pool.length < count) {
    const err = new Error(`Refusing to invent news: ${pool.length} stories corroborated by two publishers within 7 days (need ${count}).`);
    err.code = 'not_enough_confirmed';
    err.confirmed = confirmed.length;
    throw err;
  }
  const rank = r => {
    const blob = `${r.claim} ${r.sources.map(s => s.title).join(' ')}`;
    const soft = ['sports', 'entertainment'].includes(r.category) ? 2 : 0;
    const hot = r.controversial || r.breaking ? 1 : 0;
    const death = /\b(kills|killed|dead|death|murder|shark)\b/i.test(blob) ? 1 : 0;
    const preferred = ['politics', 'science', 'space', 'economy', 'tech'].includes(r.category) ? 0 : 1;
    return soft * 1e15 + death * 1e14 + hot * 1e13 - r.independentPublishers * 1e12 + preferred * 1e10 + ageHours(r) * 1e3;
  };
  pool.sort((a, b) => rank(a) - rank(b));
  const picked = [];
  for (const r of pool) {
    if (picked.some(p => jaccard(tokens(p.claim), tokens(r.claim)) >= 0.45)) continue;
    const orgs = new Set(r.sources.map(s => s.org));
    if ([...orgs].some(o => !o)) continue;
    picked.push(r);
    if (picked.length === count) break;
  }
  if (picked.length < count) {
    throw new Error(`Refusing to invent news: only ${picked.length} distinct corroborated stories after de-duplication.`);
  }
  return { stories: picked, ageWindowHours: window };
}

function candidatesFromEngine(engine, orgMap) {
  return engine.stories().map(story => ({
    id: story.id,
    headline: story.headline,
    summary: story.summary,
    category: story.category,
    engineCorroboration: story.corroboration,
    reviewStatus: story.reviewStatus,
    breaking: !!story.breaking,
    controversial: !!story.controversial,
    items: story.items.map(i => ({
      sourceId: i.sourceId,
      org: orgMap[i.sourceId] || i.sourceId,
      publisher: i.sourceName,
      url: i.link,
      title: i.title,
      summary: i.summary || '',
      published: i.published || null,
      kind: i.kind || 'rss',
      engineStoryId: story.id,
      controversial: !!story.controversial,
      breaking: !!story.breaking,
    })),
  }));
}

module.exports = {
  related, factCheckItems, selectStories, candidatesFromEngine, anchorsOf, rareAnchors, contentTokens,
};
