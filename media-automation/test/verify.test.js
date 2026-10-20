'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const { verifyStory, quantities, wireOf, NewsEngine } = require('../src/news');
const { tmp, rss, mockFetch } = require('./helpers');
const NOW = new Date('2026-10-20T12:00:00Z');
const it = (sourceId, title, summary, extra = {}) => ({ sourceId, title, summary, link: `https://${sourceId}.example/a`, published: '2026-10-20T08:00:00Z', ...extra });

test('quantities and wire detection', () => {
  assert.deepEqual(quantities('12 people killed, prices rose 3.5% in 2026'), [{ value: 12, unit: 'people' }, { value: 3.5, unit: '%' }]);
  assert.equal(wireOf('LONDON (Reuters) - ...'), 'Reuters'); assert.equal(wireOf('(AP) — The'), 'AP'); assert.equal(wireOf('local report'), null);
});
test('two independent outlets -> confirmed', () => {
  const v = verifyStory([it('a', 'Bridge opens in city', 'The new bridge opened to traffic on Monday morning after years of work.'), it('b', 'City bridge opened', 'Officials cut the ribbon as cars crossed the long-awaited bridge.')], { now: NOW });
  assert.equal(v.status, 'confirmed'); assert.equal(v.independentOrigins, 2);
});
test('same ownership group counts once -> unconfirmed', () => {
  const v = verifyStory([it('a', 'Bridge opens', 'x one'), it('b', 'Bridge opened', 'y two')], { now: NOW, sources: { a: { owner: 'MediaCorp' }, b: { owner: 'MediaCorp' } } });
  assert.equal(v.status, 'unconfirmed'); assert.equal(v.independentOrigins, 1); assert.ok(v.reasons.includes('same_origin_only'));
});
test('wire syndication (AP in both) counts once', () => {
  const v = verifyStory([it('a', 'Quake hits coast', '(AP) A strong quake struck the coast.'), it('b', 'Coast quake', 'A quake struck, the Associated Press reported.')], { now: NOW });
  assert.equal(v.independentOrigins, 1); assert.equal(v.status, 'unconfirmed'); assert.ok(v.syndicated.length >= 1);
});
test('near-identical text (copy-paste syndication) counts once', () => {
  const txt = 'The regional council approved the new transport budget after a long debate on Tuesday evening.';
  const v = verifyStory([it('a', 'Council approves budget', txt), it('b', 'Budget approved', txt + ' ')], { now: NOW });
  assert.equal(v.independentOrigins, 1); assert.equal(v.syndicated[0].sameAs, 'src:a');
});
test('primary/official source confirms alone; primaryDomains', () => {
  assert.equal(verifyStory([it('gov', 'Ministry statement', 'Text')], { now: NOW, sources: { gov: { primary: true } } }).status, 'confirmed');
  const v = verifyStory([it('x', 'NASA update', 'Text', { link: 'https://www.nasa.gov/news/1' })], { now: NOW, primaryDomains: ['nasa.gov'] });
  assert.deepEqual(v.primarySource, ['x']);
});
test('number contradiction -> disputed (even with many sources)', () => {
  const v = verifyStory([it('a', 'Storm: 12 people dead', 'A'), it('b', 'Storm leaves 30 people dead', 'B'), it('c', 'Storm hits', 'C')], { now: NOW });
  assert.equal(v.status, 'disputed'); assert.equal(v.contradictions[0].unit, 'people');
});
test('denial -> disputed', () => {
  assert.equal(verifyStory([it('a', 'Minister resigns', 'A'), it('b', 'Ministry denies minister resigned', 'B')], { now: NOW }).status, 'disputed');
});
test('date checks: future -> unconfirmed; stale warning; spread', () => {
  assert.equal(verifyStory([it('a', 'X', 'a', { published: '2026-11-30T00:00:00Z' }), it('b', 'X', 'b')], { now: NOW }).status, 'unconfirmed');
  const v = verifyStory([it('a', 'X', 'a1', { published: '2026-10-10T00:00:00Z' }), it('b', 'X', 'b1')], { now: NOW });
  assert.ok(v.reasons.includes('stale_warning')); assert.ok(v.dateIssues.some(d => d.issue === 'date_spread'));
});
test('engine integration: disputed story requires approval, reasons recorded', async () => {
  const A = 'https://a.example/rss', B = 'https://b.example/rss';
  const f = mockFetch({ [A]: [{ status: 200, body: rss([{ title: 'Flood in river valley leaves 12 people dead', link: 'https://a.example/1' }]) }],
    [B]: [{ status: 200, body: rss([{ title: 'Flood in river valley leaves 40 people dead', link: 'https://b.example/1' }]) }] });
  const e = new NewsEngine({ statePath: path.join(tmp(), 's.json'), fetchFn: f, sources: [{ id: 'a', url: A }, { id: 'b', url: B }] });
  await e.run(); const [s] = e.stories();
  assert.equal(s.corroboration, 'disputed'); assert.equal(s.reviewStatus, 'pending_approval'); assert.ok(s.reviewReasons.includes('disputed'));
});
