'use strict';
const { tokens, jaccard } = require('./dedup');
const WIRES = [['AP', /\b(AP|Associated Press)\b/], ['Reuters', /\bReuters\b/i], ['AFP', /\b(AFP|Agence France-Presse)\b/], ['Bloomberg', /\bBloomberg\b/], ['dpa', /\bdpa\b/]];
const DENIAL = /\b(denied|denies|false|fake|hoax|refuted|not true|debunked)\b/i;
const UNIT_STOP = new Set(['the', 'a', 'of', 'and', 'in', 'on', 'to', 'percent']);

function wireOf(text) { for (const [n, re] of WIRES) if (re.test(text)) return n; return null; }
/** "12 people killed" -> {12, 'people'}; "rose 3.5%" -> {3.5, '%'}; years ignored. */
function quantities(text) {
  const out = [];
  for (const m of String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*(%|[a-zA-Z]+)?/g)) {
    const v = parseFloat(m[1].replace(',', '.')); let unit = (m[2] || '').toLowerCase();
    if (/^(19|20)\d\d$/.test(m[1])) continue; if (UNIT_STOP.has(unit) || !unit) continue;
    out.push({ value: v, unit: unit === 'percent' ? '%' : unit.replace(/s$/, '') });
  }
  return out;
}
/**
 * Analyse a cluster of items. src lookup provides { owner, primary, kind } per sourceId.
 * Returns { status: confirmed|primary_only|unconfirmed|disputed, independentOrigins, origins, primarySource, syndicated, contradictions, dateIssues, reasons }
 */
function verifyStory(items, { sources = {}, now = new Date(), maxAgeHours = 48, maxSpreadHours = 72, simThreshold = 0.8, minIndependent = 2, primaryDomains = [] } = {}) {
  const origins = []; // groups of items considered one origin
  const originOf = new Map(); const syndicated = [];
  for (const it of items) {
    const s = sources[it.sourceId] || {};
    const text = `${it.title} ${it.summary || ''}`; const wire = wireOf(text);
    let key = wire ? `wire:${wire}` : s.owner ? `owner:${s.owner}` : `src:${it.sourceId}`;
    // syndication by near-identical text with an existing origin
    if (!wire) { const tk = tokens(it.summary || it.title);
      for (const o of origins) if (o.texts.some(t => jaccard(t, tk) >= simThreshold && (it.summary || '').length > 40)) { syndicated.push({ sourceId: it.sourceId, sameAs: o.key }); key = o.key; break; } }
    let o = origins.find(x => x.key === key); if (!o) { o = { key, items: [], texts: [] }; origins.push(o); }
    o.items.push(it.sourceId); o.texts.push(tokens(it.summary || it.title)); originOf.set(it, key);
    if (wire && !syndicated.some(x => x.sourceId === it.sourceId)) syndicated.push({ sourceId: it.sourceId, wire });
  }
  const isPrimary = it => { const s = sources[it.sourceId] || {}; if (s.primary || it.kind === 'official' || s.kind === 'official' || it.primarySourceUrl || it.editorialStatus === 'confirmed-primary') return true;
    try { const h = new URL(it.link).host.replace(/^www\./, ''); return primaryDomains.some(d => h === d || h.endsWith('.' + d)); } catch { return false; } };
  const primary = items.filter(isPrimary).map(i => i.sourceId);
  // dates
  const dateIssues = []; const times = [];
  for (const it of items) { if (!it.published) continue; const t = Date.parse(it.published); if (isNaN(t)) { dateIssues.push({ sourceId: it.sourceId, issue: 'unparseable_date' }); continue; }
    times.push(t); const ageH = (now - t) / 36e5;
    if (ageH < -1) dateIssues.push({ sourceId: it.sourceId, issue: 'future_date' }); else if (ageH > maxAgeHours) dateIssues.push({ sourceId: it.sourceId, issue: 'stale', ageHours: Math.round(ageH) }); }
  if (times.length > 1 && (Math.max(...times) - Math.min(...times)) / 36e5 > maxSpreadHours) dateIssues.push({ issue: 'date_spread', hours: Math.round((Math.max(...times) - Math.min(...times)) / 36e5) });
  // contradictions across different origins
  const contradictions = []; const byUnit = new Map();
  for (const it of items) for (const q of quantities(`${it.title} ${it.summary || ''}`)) {
    const prev = byUnit.get(q.unit); const k = originOf.get(it);
    if (!prev) byUnit.set(q.unit, { value: q.value, origin: k, sourceId: it.sourceId });
    else if (prev.origin !== k && Math.abs(prev.value - q.value) / Math.max(prev.value, q.value, 1e-9) > 0.1)
      contradictions.push({ type: 'number_mismatch', unit: q.unit, a: { source: prev.sourceId, value: prev.value }, b: { source: it.sourceId, value: q.value } });
  }
  const denials = items.filter(i => DENIAL.test(`${i.title} ${i.summary || ''}`)).map(i => i.sourceId);
  if (denials.length && denials.length < items.length) contradictions.push({ type: 'claim_denied', sources: denials });

  const independentOrigins = origins.length; const reasons = [];
  let status;
  if (contradictions.length) { status = 'disputed'; reasons.push('contradiction'); }
  else if (dateIssues.some(d => d.issue === 'future_date' || d.issue === 'unparseable_date')) { status = 'unconfirmed'; reasons.push('date_invalid'); }
  // Editorial rule (Studio 4 owner follow-up): CONFIRMED = primary source (official/originating outlet) + independent corroboration.
  // Primary alone -> primary_only (owner review unless low-risk official self-announcement, see engine). Media without primary -> unconfirmed.
  else if (primary.length && independentOrigins >= minIndependent) { status = 'confirmed'; reasons.push('primary_source', 'independent_corroboration'); }
  else if (primary.length) { status = 'primary_only'; reasons.push('primary_source', 'no_independent_corroboration'); }
  else { status = 'unconfirmed'; reasons.push(independentOrigins >= minIndependent ? 'no_primary_source' : items.length > 1 ? 'same_origin_only' : 'single_source'); }
  if (status === 'confirmed' && dateIssues.some(d => d.issue === 'stale')) reasons.push('stale_warning');
  return { status, independentOrigins, origins: origins.map(o => ({ key: o.key, sources: o.items })), primarySource: primary, syndicated, contradictions, dateIssues, reasons };
}
module.exports = { verifyStory, quantities, wireOf };
